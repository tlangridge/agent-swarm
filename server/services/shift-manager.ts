import { randomUUID } from 'crypto';
import { nanoid } from 'nanoid';
import type { Office, OfficeSlot, PipelineStage } from './office-store.js';
import { getOffice, saveOffice } from './office-store.js';
import { fireWebhook } from './webhooks.js';
import type { FunctionalRole, SwarmRole } from './swarm-registry.js';
import { addMember, removeMember, getMemberByName, getMembers, getMembersByOffice, swarmEvents } from './swarm-registry.js';
import { listAgents, saveAgent } from './agent-store.js';
import { provisionInbox } from './agentmail.js';
import { spawnSession, sessions, killSession, PORT } from '../pty-manager.js';
import type { CliType } from '../pty-manager.js';
import { buildOrientationMessage } from './swarm-prompts.js';
import type { PersonaContext } from './swarm-prompts.js';
import { injectMessage } from './pty-writer.js';
import { startScheduler, stopScheduler } from './cron-scheduler.js';
import { getProjectPath } from '../routes/project.js';
import { isGitRepo, createWorktree, removeWorktree } from './worktree.js';
import { startContextMonitor, stopContextMonitor } from './context-monitor.js';
import { listFiles, readFile, writeFile } from './workspace-files.js';
import { listTasks } from './task-board.js';
import type { TaskItem } from './task-board.js';
import { initCostTracking, getOfficeCostSummary } from './cost-tracker.js';
import { resolveKeysForSession } from './key-store.js';

export type ShiftSlotStatus = 'pending' | 'booting' | 'active' | 'failed' | 'ended';
export type ShiftStatus = 'starting' | 'active' | 'review' | 'closing' | 'ending' | 'ended';

export interface ShiftSlotState {
  slotIndex: number;
  name: string;
  functionalRole: FunctionalRole;
  status: ShiftSlotStatus;
  sessionId?: string;
  worktreeBranch?: string;
  worktreePath?: string;
  error?: string;
  retryCount?: number;
  pendingTimeouts?: ReturnType<typeof setTimeout>[];
}

export interface ShiftState {
  officeId: string;
  officeName: string;
  startedAt: string;
  status: ShiftStatus;
  slots: ShiftSlotState[];
  reviewSummary?: string;
  shiftNumber?: number;
  closingStartedAt?: string;
  closeDocPath?: string;
  closeTimeout?: ReturnType<typeof setTimeout>;
}

const activeShifts = new Map<string, ShiftState>();

export function getActiveShift(officeId?: string): ShiftState | null {
  if (officeId) return activeShifts.get(officeId) ?? null;
  // Backward compat: return first non-ended shift
  for (const shift of activeShifts.values()) {
    if (shift.status !== 'ended') return shift;
  }
  return null;
}

export function getActiveShifts(): ShiftState[] {
  return Array.from(activeShifts.values()).filter(s => s.status !== 'ended');
}

export function getShiftBySessionId(sessionId: string): ShiftState | null {
  for (const shift of activeShifts.values()) {
    if (shift.slots.some(s => s.sessionId === sessionId)) return shift;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Broadcast shift progress to all connected clients via swarm events
function emitShiftProgress(officeId: string, slotIndex: number, slotName: string, status: ShiftSlotStatus, sessionId?: string, error?: string): void {
  swarmEvents.emit('shift:progress', { officeId, slotIndex, slotName, status, sessionId, error });
}

function emitShiftStatus(shift: ShiftState): void {
  swarmEvents.emit('shift:status', { shift });
}

async function generateCloseDocument(shift: ShiftState, office: Office): Promise<string> {
  const now = new Date();
  const startedAt = new Date(shift.startedAt);
  const durationMs = now.getTime() - startedAt.getTime();
  const durationMin = Math.round(durationMs / 60_000);
  const hours = Math.floor(durationMin / 60);
  const mins = durationMin % 60;
  const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  const lines: string[] = [
    `# Shift #${shift.shiftNumber} Close Report`,
    '',
    `- **Office**: ${office.name}`,
    `- **Shift Number**: ${shift.shiftNumber}`,
    `- **Started**: ${shift.startedAt}`,
    `- **Closed**: ${now.toISOString()}`,
    `- **Duration**: ${durationStr}`,
    '',
  ];

  // Team Roster table
  lines.push('## Team Roster', '');
  lines.push('| Agent | Role | Status | Worktree Branch |');
  lines.push('|-------|------|--------|-----------------|');
  for (const slot of shift.slots) {
    const branch = slot.worktreeBranch || '-';
    lines.push(`| ${slot.name} | ${slot.functionalRole} | ${slot.status} | ${branch} |`);
  }
  lines.push('');

  // Task Summary grouped by status
  const tasks = await listTasks({ officeId: shift.officeId });
  const grouped: Record<string, TaskItem[]> = { done: [], 'in-progress': [], open: [], blocked: [] };
  for (const t of tasks) {
    if (grouped[t.status]) {
      grouped[t.status].push(t);
    } else {
      grouped[t.status] = [t];
    }
  }

  lines.push('## Task Summary', '');
  for (const status of ['done', 'in-progress', 'open', 'blocked']) {
    const group = grouped[status];
    if (!group || group.length === 0) continue;
    lines.push(`### ${status} (${group.length})`, '');
    for (const t of group) {
      const assignee = t.assignedTo || 'unassigned';
      const output = t.output ? ` — ${t.output}` : '';
      lines.push(`- **${t.id}** ${t.title} (${assignee})${output}`);
    }
    lines.push('');
  }

  // Worktree Branches
  const worktreeSlots = shift.slots.filter(s => s.worktreeBranch);
  if (worktreeSlots.length > 0) {
    lines.push('## Worktree Branches', '');
    for (const s of worktreeSlots) {
      lines.push(`- ${s.name}: \`${s.worktreeBranch}\``);
    }
    lines.push('');
  }

  lines.push('---', '');
  lines.push('## Agent Reports', '');
  lines.push('_Agents: append your shift notes below._', '');

  return lines.join('\n');
}

export async function getLastCloseDocument(officeId: string): Promise<{ content: string; shiftNumber: number; path: string } | null> {
  const index = await listFiles(officeId);
  const closeFiles = index.files.filter(f => /^shifts\/shift-\d+-close\.md$/.test(f.path));

  if (closeFiles.length === 0) return null;

  // Sort by shift number extracted from filename (descending), pick highest
  closeFiles.sort((a, b) => {
    const numA = parseInt(a.path.match(/shift-(\d+)-close/)![1], 10);
    const numB = parseInt(b.path.match(/shift-(\d+)-close/)![1], 10);
    return numB - numA;
  });

  const latest = closeFiles[0];
  const shiftNumber = parseInt(latest.path.match(/shift-(\d+)-close/)![1], 10);

  const result = await readFile(officeId, latest.path);
  if (!result) return null;

  let content = result.content;

  // If content is too long, truncate the Agent Reports section
  if (content.length > 4000) {
    const agentReportsIdx = content.indexOf('## Agent Reports');
    if (agentReportsIdx !== -1) {
      content = content.slice(0, agentReportsIdx) + '## Agent Reports\n\n_[Truncated — see full report in workspace]_\n';
    }
  }

  return { content, shiftNumber, path: latest.path };
}

export async function badgeIn(office: Office, broadcast: (data: unknown) => void): Promise<ShiftState> {
  const existing = activeShifts.get(office.id);
  if (existing && existing.status !== 'ended') {
    throw new Error(`Office "${office.name}" already has an active shift.`);
  }

  const shift: ShiftState = {
    officeId: office.id,
    officeName: office.name,
    startedAt: new Date().toISOString(),
    status: 'starting',
    slots: office.slots.map((slot, i) => ({
      slotIndex: i,
      name: slot.name,
      functionalRole: slot.functionalRole,
      status: 'pending' as ShiftSlotStatus,
    })),
  };
  activeShifts.set(office.id, shift);
  emitShiftStatus(shift);

  const lastClose = await getLastCloseDocument(office.id);

  const projectPath = office.projectPath || getProjectPath() || undefined;
  const allAgents = await listAgents();

  // Determine lead: first tech-lead slot, or first slot if none
  const leadIndex = office.slots.findIndex(s => s.functionalRole === 'tech-lead');
  const effectiveLeadIndex = leadIndex >= 0 ? leadIndex : 0;

  const spawnMode = office.spawnMode ?? 'eager';

  // Boot agents sequentially with stagger
  for (let i = 0; i < office.slots.length; i++) {
    const slot = office.slots[i];
    const slotState = shift.slots[i];

    // In demand mode, skip non-lead slots unless explicitly marked autoSpawn
    if (spawnMode === 'demand') {
      const isLeadSlot = i === effectiveLeadIndex;
      if (!isLeadSlot && slot.autoSpawn !== true) {
        slotState.status = 'pending';
        emitShiftProgress(office.id, i, slot.name, 'pending');
        continue;
      }
    }

    // Skip if already running (verify session actually exists, not just stale registry)
    const existingMember = getMemberByName(slot.name, office.id);
    if (existingMember && sessions.has(existingMember.sessionId)) {
      slotState.status = 'failed';
      slotState.error = `Agent "${slot.name}" is already running`;
      emitShiftProgress(office.id, i, slot.name, 'failed', undefined, slotState.error);
      continue;
    }
    // Clean up stale registry entry if session is gone
    if (existingMember) {
      removeMember(existingMember.sessionId);
    }

    slotState.status = 'booting';
    emitShiftProgress(office.id, i, slot.name, 'booting');

    try {
      // Resolve or create agent identity
      const existing = allAgents.find(a => a.name.toLowerCase() === slot.name.toLowerCase());
      let agent: { id: string; name: string; email: string };
      let agentSoul: string | undefined;
      let agentMemory: string | undefined;
      let agentInstructions: string | undefined;

      if (existing) {
        agent = { id: existing.id, name: existing.name, email: existing.email };
        agentSoul = existing.soul;
        agentMemory = existing.memory;
        agentInstructions = existing.instructions;
      } else {
        const id = nanoid(8);
        let email = '';
        let inboxId = '';
        try {
          const inbox = await provisionInbox(slot.name);
          if (inbox) { email = inbox.email; inboxId = inbox.inboxId; }
        } catch { /* graceful degradation */ }

        const now = new Date().toISOString();
        await saveAgent({
          id, name: slot.name, email, inboxId,
          credentials: {},
          defaultCliType: slot.cliType,
          createdAt: now, updatedAt: now,
        });
        agent = { id, name: slot.name, email };
        // Add to our local list so subsequent slots can find it
        allAgents.push({ id, name: slot.name, email, inboxId, credentials: {}, defaultCliType: slot.cliType, createdAt: now, updatedAt: now });
      }

      const sessionId = randomUUID();
      const cliType = slot.cliType as CliType;
      const swarmRole: SwarmRole = i === effectiveLeadIndex ? 'lead' : 'worker';
      const permissionMode = slot.permissionMode || 'autonomous';
      const executionMode = slot.executionMode || 'local';

      const personaCtx: PersonaContext = {
        agentSoul,
        agentMemory,
        agentInstructions,
        officeSoul: office.soul,
        officeMemory: office.memory,
        officeInstructions: office.instructions,
        slotSoul: slot.soul,
        slotMemory: slot.memory,
        slotInstructions: slot.instructions,
      };

      // Create per-agent worktree if enabled
      let agentProjectPath = projectPath;
      let worktreeBranch: string | undefined;

      const worktreeMode = office.worktreeMode ?? 'per-agent';
      const slotUseWorktree = slot.useWorktree !== false;

      if (worktreeMode === 'per-agent' && slotUseWorktree && projectPath && isGitRepo(projectPath)) {
        const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const safeName = slot.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        const branch = `swarm/${safeName}/${date}`;
        try {
          try {
            // Remove stale worktree from a previous shift on the same day
            removeWorktree(projectPath, branch);
          } catch {
            // Doesn't exist or already removed — fine
          }
          const wt = createWorktree(projectPath, branch);
          agentProjectPath = wt.path;
          worktreeBranch = branch;
          slotState.worktreeBranch = branch;
          slotState.worktreePath = wt.path;
        } catch (err) {
          console.warn(`Worktree creation failed for ${slot.name}, using shared checkout:`, err);
        }
      }

      const resolvedKeys = resolveKeysForSession(office.id);
      spawnSession(
        sessionId, cliType, 80, 24, agent,
        executionMode, permissionMode, swarmRole,
        agentProjectPath, slot.functionalRole, office.pipeline, personaCtx,
        worktreeBranch, office.id, slot.skills, resolvedKeys,
      );

      addMember({
        sessionId,
        officeId: office.id,
        agentId: agent.id,
        agentName: agent.name,
        agentEmail: agent.email,
        cliType,
        executionMode,
        role: swarmRole,
        functionalRole: slot.functionalRole,
        joinedAt: new Date().toISOString(),
      });

      // Initialize cost tracking for this session
      initCostTracking(sessionId, agent.name, office.id, slot.budgetCents);

      // Emit session:spawned for ws-handler to bridge output + create tile
      swarmEvents.emit('session:spawned', {
        sessionId,
        officeId: office.id,
        agentId: agent.id,
        agentName: agent.name,
        agentEmail: agent.email,
        cliType,
        executionMode,
        swarmRole,
        functionalRole: slot.functionalRole,
        worktreeBranch,
      });

      // For non-Claude/non-bash agents, inject orientation after the CLI has initialized
      if (!slotState.pendingTimeouts) slotState.pendingTimeouts = [];
      if (cliType !== 'claude' && cliType !== 'bash') {
        const swarmApiUrl = executionMode === 'docker'
          ? `http://host.docker.internal:${PORT}`
          : `http://localhost:${PORT}`;
        const orientation = buildOrientationMessage(swarmRole, agent.name, sessionId, swarmApiUrl, agentProjectPath, worktreeBranch, slot.functionalRole, personaCtx);
        slotState.pendingTimeouts.push(setTimeout(() => injectMessage(sessionId, orientation), 2000));
      }

      slotState.status = 'active';
      slotState.sessionId = sessionId;
      emitShiftProgress(office.id, i, slot.name, 'active', sessionId);

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      slotState.status = 'failed';
      slotState.error = message;
      emitShiftProgress(office.id, i, slot.name, 'failed', undefined, message);
      console.error(`Badge-in failed for ${slot.name}:`, message);
    }

    // Stagger: wait 2s between spawns (except after the last one)
    if (i < office.slots.length - 1) {
      await sleep(2000);
    }
  }

  shift.status = 'active';
  emitShiftStatus(shift);
  fireWebhook('shift:started', { officeId: office.id, officeName: office.name, agentCount: shift.slots.filter(s => s.status === 'active').length });

  // Start context health monitoring
  startContextMonitor(office.id);

  // Start cron scheduler
  const resolveTargets = (job: { targetAgent?: string; targetRole?: FunctionalRole }) => {
    const members = getMembersByOffice(office.id);
    const ids: string[] = [];
    if (job.targetAgent) {
      const lower = job.targetAgent.toLowerCase();
      for (const m of members) if (m.agentName?.toLowerCase() === lower) ids.push(m.sessionId);
    } else if (job.targetRole) {
      for (const m of members) if (m.functionalRole === job.targetRole) ids.push(m.sessionId);
    } else {
      for (const m of members) ids.push(m.sessionId);
    }
    return ids;
  };
  startScheduler(office, resolveTargets, injectMessage);
  startIdleMonitor(office);

  // Send kickoff message to the lead agent
  const leadSlot = shift.slots[effectiveLeadIndex];
  if (leadSlot.sessionId && leadSlot.status === 'active') {
    const teamList = shift.slots
      .filter(s => s.status === 'active')
      .map(s => `  - ${s.name} (${s.functionalRole})`)
      .join('\n');

    const kickoffParts: string[] = ['[SWARM SYSTEM]: Your shift has started.'];

    // Office context
    kickoffParts.push(`\n=== OFFICE: ${office.name} ===`);
    if (projectPath) {
      kickoffParts.push(`Project: ${projectPath}`);
    }
    if (office.soul) {
      kickoffParts.push(office.soul);
    }
    if (office.instructions) {
      kickoffParts.push(office.instructions);
    }

    // Team
    kickoffParts.push(`\nYour team:\n${teamList}`);

    // Pipeline
    if (office.pipeline && office.pipeline.length > 0) {
      const pipelineList = office.pipeline
        .map((stage, i) => `  ${i + 1}. ${stage.name}: ${stage.description} [${stage.assignedRoles.join(', ')}]`)
        .join('\n');
      kickoffParts.push(`\nPipeline stages:\n${pipelineList}`);
    }

    // Previous shift close report
    if (lastClose) {
      kickoffParts.push(
        `\n=== PREVIOUS SHIFT (#${lastClose.shiftNumber}) CLOSE REPORT ===`,
        lastClose.content,
        '=== END PREVIOUS SHIFT REPORT ===',
      );
    }

    // Instructions
    kickoffParts.push(
      '\nUse the `swarm` CLI for team coordination. Run `swarm help` for available commands.',
      '\nStart by:',
      '1. Read existing context: `swarm context`',
      '2. Check current tasks: `swarm tasks`',
      '3. If no tasks exist, wait for the user\'s mission, then break it into tasks and assign them.',
      '4. Set up a PM check-in: `swarm cron create --name "PM Check-In" --schedule "every 10m" --target-role product-manager --prompt "Check task board with swarm tasks. Review progress, identify blocked tasks, and message the lead with a brief status update. Flag any stale or stuck agents."`',
    );

    const kickoff = kickoffParts.join('\n');
    if (!leadSlot.pendingTimeouts) leadSlot.pendingTimeouts = [];
    leadSlot.pendingTimeouts.push(setTimeout(() => injectMessage(leadSlot.sessionId!, kickoff), 3000));
  }

  // Send "stand by" message to ALL worker agents so they don't start working prematurely
  const workerSlots = shift.slots.filter((s, i) => s.status === 'active' && s.sessionId && i !== effectiveLeadIndex);
  if (workerSlots.length > 0) {
    const standbyParts = [
      '[SWARM SYSTEM]: Shift started. You are a worker agent.',
      'STAND BY — do NOT start any work yet.',
      'The lead is setting up the mission and will assign you tasks shortly.',
      'While you wait:',
      '  1. Run `swarm tasks --mine` to check for pre-assigned tasks',
      '  2. Run `swarm context` to read the workspace context',
      '  3. If you have no tasks, WAIT for a message from the lead.',
      'Do NOT explore the codebase, write code, or take any action until you have a task.',
    ];
    if (lastClose) {
      standbyParts.push(`Previous shift (#${lastClose.shiftNumber}) close report is available. Run: swarm read ${lastClose.path}`);
    }
    const standbyMsg = standbyParts.join('\n');
    const standbyTimer = setTimeout(() => {
      for (const slot of workerSlots) {
        injectMessage(slot.sessionId!, standbyMsg);
      }
    }, 4000);
    for (const slot of workerSlots) {
      if (!slot.pendingTimeouts) slot.pendingTimeouts = [];
      slot.pendingTimeouts.push(standbyTimer);
    }
  }

  return shift;
}

export async function badgeOut(officeId: string): Promise<ShiftState | null> {
  const shift = activeShifts.get(officeId);
  if (!shift) return null;

  if (shift.closeTimeout) {
    clearTimeout(shift.closeTimeout);
    shift.closeTimeout = undefined;
  }

  stopScheduler(officeId);
  stopIdleMonitor(officeId);
  stopContextMonitor(officeId);
  shift.status = 'ending';
  emitShiftStatus(shift);

  // Cancel all pending timeouts for all slots before killing sessions
  for (const slot of shift.slots) {
    if (slot.pendingTimeouts) {
      for (const t of slot.pendingTimeouts) clearTimeout(t);
      slot.pendingTimeouts = [];
    }
  }

  // Kill all sessions known to the shift
  for (const slot of shift.slots) {
    if (slot.sessionId && slot.status === 'active') {
      try {
        killSession(slot.sessionId);
        slot.status = 'ended';
      } catch {
        // Session may already be dead
        slot.status = 'ended';
      }
    }
  }

  // Clean up any orphaned members left in the registry for this office
  for (const member of getMembersByOffice(officeId)) {
    removeMember(member.sessionId);
  }

  // Log preserved worktrees for human review
  const worktreeSummary = shift.slots
    .filter(s => s.worktreeBranch)
    .map(s => `  ${s.name}: ${s.worktreeBranch}`)
    .join('\n');
  if (worktreeSummary) {
    console.log(`Shift worktrees preserved:\n${worktreeSummary}`);
  }

  // Capture cost summary before ending
  const costSummary = getOfficeCostSummary(shift.officeId);
  if (costSummary.totalCost > 0) {
    console.log(`Shift cost summary for "${shift.officeName}": $${costSummary.totalCost.toFixed(2)} total`);
    for (const ac of costSummary.agentCosts) {
      const budgetStr = ac.budgetCents != null
        ? ` (budget: $${(ac.budgetCents / 100).toFixed(2)}, ${ac.budgetPercent?.toFixed(0)}% used)`
        : '';
      console.log(`  ${ac.agentName}: $${ac.totalCost.toFixed(2)}${budgetStr}`);
    }
  }

  shift.status = 'ended';
  emitShiftStatus(shift);
  fireWebhook('shift:ended', {
    officeId: shift.officeId,
    officeName: shift.officeName,
    totalCost: costSummary.totalCost,
    agentCosts: costSummary.agentCosts,
  });

  activeShifts.delete(officeId);
  return shift;
}

export async function closeShift(officeId: string): Promise<{ closing: boolean; shiftNumber: number; closeDocPath: string }> {
  const shift = activeShifts.get(officeId);
  if (!shift || (shift.status !== 'active' && shift.status !== 'review')) {
    throw new Error('No active shift to close');
  }

  const office = await getOffice(officeId);
  if (!office) throw new Error('Office not found');

  // Increment shift number
  const shiftNumber = (office.nextShiftNumber ?? 1);
  office.nextShiftNumber = shiftNumber + 1;
  office.updatedAt = new Date().toISOString();
  await saveOffice(office);

  // Update shift state
  shift.status = 'closing';
  shift.shiftNumber = shiftNumber;
  shift.closingStartedAt = new Date().toISOString();
  emitShiftStatus(shift);

  // Stop scheduler, idle monitor, and context monitor
  stopScheduler(officeId);
  stopIdleMonitor(officeId);
  stopContextMonitor(officeId);

  // Generate and write close document
  const closeDoc = await generateCloseDocument(shift, office);
  const nnn = String(shiftNumber).padStart(3, '0');
  const closeDocPath = `shifts/shift-${nnn}-close.md`;
  await writeFile(officeId, closeDocPath, closeDoc, 'system', `Shift #${shiftNumber} close report`);
  shift.closeDocPath = closeDocPath;

  // Inject close-request message to all active agents
  const closeMsg = [
    `[SWARM SYSTEM]: Shift #${shiftNumber} is closing.`,
    `You have 60 seconds to append your shift notes to the close report.`,
    `Run: swarm write ${closeDocPath} --append "Your notes here"`,
    `After 60 seconds, all agents will be signed out automatically.`,
  ].join('\n');

  for (const slot of shift.slots) {
    if (slot.sessionId && slot.status === 'active') {
      injectMessage(slot.sessionId, closeMsg);
    }
  }

  // Set timeout to badge out after 60 seconds
  shift.closeTimeout = setTimeout(() => badgeOut(officeId), 60_000);

  fireWebhook('shift:closing', { officeId, officeName: office.name, shiftNumber, closeDocPath });

  return { closing: true, shiftNumber, closeDocPath };
}

export async function handleSlotExit(sessionId: string, exitCode: number): Promise<void> {
  const shift = getShiftBySessionId(sessionId);
  if (!shift || (shift.status !== 'active' && shift.status !== 'closing')) return;

  const slotState = shift.slots.find(s => s.sessionId === sessionId);
  if (!slotState) return;

  // Cancel any pending timeouts for this slot (orientation, kickoff, standby messages)
  if (slotState.pendingTimeouts) {
    for (const t of slotState.pendingTimeouts) clearTimeout(t);
    slotState.pendingTimeouts = [];
  }

  // During closing, mark as ended but don't attempt respawn
  if (shift.status === 'closing') {
    slotState.status = 'ended';
    emitShiftProgress(shift.officeId, slotState.slotIndex, slotState.name, 'ended');
    return;
  }

  const retries = slotState.retryCount || 0;

  // Skip retry for unrecoverable exit codes
  const isUnrecoverable = exitCode === 126 || exitCode === 127;

  // Only respawn on non-zero exit (crash) with retries remaining
  if (exitCode !== 0 && retries < 3 && !isUnrecoverable) {
    slotState.retryCount = retries + 1;
    slotState.status = 'booting';
    emitShiftProgress(shift.officeId, slotState.slotIndex, slotState.name, 'booting');

    // Exponential backoff before respawn (1s, 2s, 4s, capped at 5s)
    const backoffMs = Math.min(1000 * Math.pow(2, retries), 5000);
    if (retries > 0) {
      console.log(`${slotState.name} exited with code ${exitCode}, backing off ${backoffMs}ms before respawn attempt ${retries + 1}/3`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    } else {
      console.log(`${slotState.name} exited with code ${exitCode}, respawning (attempt ${retries + 1}/3)`);
    }

    try {
      const office = await getOffice(shift.officeId);
      if (!office) throw new Error('Office not found');

      const slot = office.slots[slotState.slotIndex];
      if (!slot) throw new Error('Slot not found in office');

      const projectPath = office.projectPath || getProjectPath() || undefined;
      const allAgents = await listAgents();
      const existing = allAgents.find(a => a.name.toLowerCase() === slot.name.toLowerCase());

      let agent: { id: string; name: string; email: string };
      let agentSoul: string | undefined;
      let agentMemory: string | undefined;
      let agentInstructions: string | undefined;

      if (existing) {
        agent = { id: existing.id, name: existing.name, email: existing.email };
        agentSoul = existing.soul;
        agentMemory = existing.memory;
        agentInstructions = existing.instructions;
      } else {
        throw new Error(`Agent identity for "${slot.name}" not found`);
      }

      const newSessionId = randomUUID();
      const cliType = slot.cliType as CliType;
      const leadIndex = office.slots.findIndex(s => s.functionalRole === 'tech-lead');
      const effectiveLeadIndex = leadIndex >= 0 ? leadIndex : 0;
      const swarmRole: SwarmRole = slotState.slotIndex === effectiveLeadIndex ? 'lead' : 'worker';

      const personaCtx: PersonaContext = {
        agentSoul, agentMemory, agentInstructions,
        officeSoul: office.soul, officeMemory: office.memory, officeInstructions: office.instructions,
        slotSoul: slot.soul, slotMemory: slot.memory, slotInstructions: slot.instructions,
      };

      // Reuse existing worktree from slotState if available
      const respawnProjectPath = slotState.worktreePath || projectPath;
      const respawnWorktreeBranch = slotState.worktreeBranch;

      const resolvedKeys = resolveKeysForSession(shift.officeId);
      spawnSession(
        newSessionId, cliType, 80, 24, agent,
        slot.executionMode || 'local', slot.permissionMode || 'autonomous', swarmRole,
        respawnProjectPath, slot.functionalRole, office.pipeline, personaCtx,
        respawnWorktreeBranch, shift.officeId, slot.skills, resolvedKeys,
      );

      addMember({
        sessionId: newSessionId,
        officeId: shift.officeId,
        agentId: agent.id,
        agentName: agent.name,
        agentEmail: agent.email,
        cliType,
        executionMode: slot.executionMode || 'local',
        role: swarmRole,
        functionalRole: slot.functionalRole,
        joinedAt: new Date().toISOString(),
      });

      // Initialize cost tracking for respawned session
      initCostTracking(newSessionId, agent.name, shift.officeId, slot.budgetCents);

      swarmEvents.emit('session:spawned', {
        sessionId: newSessionId,
        officeId: shift.officeId,
        agentId: agent.id,
        agentName: agent.name,
        agentEmail: agent.email,
        cliType,
        executionMode: slot.executionMode || 'local',
        swarmRole,
        functionalRole: slot.functionalRole,
        worktreeBranch: respawnWorktreeBranch,
      });

      // Inject orientation for non-Claude/non-bash agents (2s delay for CLI init)
      if (!slotState.pendingTimeouts) slotState.pendingTimeouts = [];
      if (cliType !== 'claude' && cliType !== 'bash') {
        const swarmApiUrl = (slot.executionMode || 'local') === 'docker'
          ? `http://host.docker.internal:${PORT}`
          : `http://localhost:${PORT}`;
        const orientation = buildOrientationMessage(swarmRole, agent.name, newSessionId, swarmApiUrl, respawnProjectPath, respawnWorktreeBranch, slot.functionalRole, personaCtx);
        slotState.pendingTimeouts.push(setTimeout(() => injectMessage(newSessionId, orientation), 2000));
      }

      slotState.sessionId = newSessionId;
      slotState.status = 'active';
      slotState.error = undefined;
      emitShiftProgress(shift.officeId, slotState.slotIndex, slotState.name, 'active', newSessionId);
      fireWebhook('agent:respawned', { agentName: slotState.name, retryCount: slotState.retryCount, newSessionId });

      // Inject rotation handoff if this was a context rotation
      const rotationHandoff = (slotState as any).rotationHandoff;
      if (rotationHandoff) {
        delete (slotState as any).rotationHandoff;
        slotState.pendingTimeouts.push(setTimeout(() => {
          injectMessage(newSessionId,
            `[SWARM SYSTEM]: You are a fresh instance of ${slotState.name}, rotated due to context pressure.\n` +
            `Here is the handoff from your previous instance:\n${rotationHandoff}\n` +
            `Continue where they left off. Check your tasks: swarm tasks --mine`
          );
        }, 4000));
      }

      console.log(`Auto-respawned ${slotState.name} (attempt ${slotState.retryCount}/3, exit code was ${exitCode})`);

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      slotState.status = 'failed';
      slotState.error = `Respawn failed (exit code ${exitCode}): ${message}`;
      emitShiftProgress(shift.officeId, slotState.slotIndex, slotState.name, 'failed', undefined, slotState.error);
      fireWebhook('agent:failed', { agentName: slotState.name, error: slotState.error, retryCount: slotState.retryCount });
      console.error(`Auto-respawn failed for ${slotState.name} (exit code ${exitCode}):`, message);
    }
  } else {
    if (isUnrecoverable) {
      slotState.status = 'failed';
      slotState.error = `Unrecoverable exit code ${exitCode} (${exitCode === 126 ? 'permission denied' : 'command not found'})`;
      emitShiftProgress(shift.officeId, slotState.slotIndex, slotState.name, 'failed', undefined, slotState.error);
      console.error(`${slotState.name} exited with unrecoverable code ${exitCode}, not retrying`);
    } else if (exitCode !== 0 && retries >= 3) {
      slotState.status = 'failed';
      slotState.error = `Max retries exhausted (exit code ${exitCode})`;
      emitShiftProgress(shift.officeId, slotState.slotIndex, slotState.name, 'failed', undefined, slotState.error);
      console.error(`${slotState.name} exited with code ${exitCode}, max retries (${retries}) exhausted`);
    } else {
      slotState.status = 'ended';
      emitShiftProgress(shift.officeId, slotState.slotIndex, slotState.name, 'ended');
      if (exitCode !== 0) {
        console.log(`${slotState.name} exited with code ${exitCode}`);
      }
    }
  }
}

export function markReadyForReview(sessionId: string, summary: string): { success: boolean; error?: string } {
  const shift = getShiftBySessionId(sessionId);
  if (!shift || shift.status !== 'active') {
    return { success: false, error: 'No active shift' };
  }

  const callerSlot = shift.slots.find(s => s.sessionId === sessionId);
  if (!callerSlot) {
    return { success: false, error: 'Session not part of active shift' };
  }

  const leadIndex = shift.slots.findIndex(s => s.functionalRole === 'tech-lead');
  const effectiveLeadIndex = leadIndex >= 0 ? leadIndex : 0;
  if (callerSlot.slotIndex !== effectiveLeadIndex) {
    return { success: false, error: 'Only the lead agent can mark shift as ready for review' };
  }

  shift.status = 'review';
  shift.reviewSummary = summary;
  emitShiftStatus(shift);
  fireWebhook('shift:ready-for-review', {
    officeId: shift.officeId,
    officeName: shift.officeName,
    summary,
  });
  return { success: true };
}

// --- Idle auto-dismiss ---
const idleMonitors = new Map<string, ReturnType<typeof setInterval>>();

export function startIdleMonitor(office: Office): void {
  const minutes = office.idleDismissMinutes ?? 0;
  if (minutes <= 0) return;

  stopIdleMonitor(office.id);
  const thresholdMs = minutes * 60 * 1000;

  const timer = setInterval(async () => {
    const shift = activeShifts.get(office.id);
    if (!shift || shift.status !== 'active') return;

    const leadIndex = office.slots.findIndex(s => s.functionalRole === 'tech-lead');
    const effectiveLeadIndex = leadIndex >= 0 ? leadIndex : 0;
    const { listTasks } = await import('./task-board.js');

    for (const slotState of shift.slots) {
      if (slotState.status !== 'active' || !slotState.sessionId) continue;
      if (slotState.slotIndex === effectiveLeadIndex) continue; // never dismiss lead

      const session = sessions.get(slotState.sessionId);
      if (!session) continue;

      const idleMs = Date.now() - session.lastDataAt.getTime();
      if (idleMs < thresholdMs) continue;

      // Check if agent has any open or in-progress tasks
      const agentTasks = await listTasks({
        assignedTo: slotState.name,
        officeId: shift.officeId,
      });
      const hasActiveTasks = agentTasks.some(t => t.status === 'open' || t.status === 'in-progress');
      if (hasActiveTasks) continue;

      // Dismiss the idle agent
      try {
        killSession(slotState.sessionId);
      } catch { /* already dead */ }

      removeMember(slotState.sessionId);
      slotState.status = 'ended';
      slotState.error = `Auto-dismissed after ${minutes}m idle`;
      emitShiftProgress(shift.officeId, slotState.slotIndex, slotState.name, 'ended');
      fireWebhook('agent:dismissed', { agentName: slotState.name, reason: 'idle', idleMinutes: minutes });

      // Notify lead
      const leadSlot = shift.slots[effectiveLeadIndex];
      if (leadSlot?.sessionId) {
        injectMessage(leadSlot.sessionId, `[SWARM SYSTEM]: ${slotState.name} auto-dismissed after ${minutes}m idle with no tasks.`);
      }

      console.log(`Auto-dismissed ${slotState.name} after ${minutes}m idle`);
    }
  }, 60_000); // check every 60s
  idleMonitors.set(office.id, timer);
}

export function stopIdleMonitor(officeId?: string): void {
  if (officeId) {
    const timer = idleMonitors.get(officeId);
    if (timer) {
      clearInterval(timer);
      idleMonitors.delete(officeId);
    }
  } else {
    // Backward compat: clear all
    for (const timer of idleMonitors.values()) clearInterval(timer);
    idleMonitors.clear();
  }
}

/** Spawn a single pending (unbooted) slot on demand */
export async function spawnSlotOnDemand(slotIndex: number, officeId?: string): Promise<ShiftSlotState | null> {
  const shift = officeId ? activeShifts.get(officeId) : getActiveShift();
  if (!shift || shift.status !== 'active') return null;
  const slotState = shift.slots[slotIndex];
  if (!slotState || slotState.status !== 'pending') return null;

  const office = await getOffice(shift.officeId);
  if (!office) return null;

  const slot = office.slots[slotIndex];
  if (!slot) return null;

  const projectPath = office.projectPath || getProjectPath() || undefined;
  const allAgents = await listAgents();

  slotState.status = 'booting';
  emitShiftProgress(office.id, slotIndex, slot.name, 'booting');

  try {
    // Resolve or create agent identity (same logic as badgeIn)
    const existing = allAgents.find(a => a.name.toLowerCase() === slot.name.toLowerCase());
    let agent: { id: string; name: string; email: string };

    if (existing) {
      agent = { id: existing.id, name: existing.name, email: existing.email };
    } else {
      const id = nanoid(8);
      let email = '';
      let inboxId = '';
      try {
        const inbox = await provisionInbox(slot.name);
        if (inbox) { email = inbox.email; inboxId = inbox.inboxId; }
      } catch { /* graceful degradation */ }

      const now = new Date().toISOString();
      await saveAgent({
        id, name: slot.name, email, inboxId,
        credentials: {},
        defaultCliType: slot.cliType,
        createdAt: now, updatedAt: now,
      });
      agent = { id, name: slot.name, email };
    }

    const sessionId = randomUUID();
    const cliType = slot.cliType as CliType;
    const leadIndex = office.slots.findIndex(s => s.functionalRole === 'tech-lead');
    const effectiveLeadIndex = leadIndex >= 0 ? leadIndex : 0;
    const swarmRole: SwarmRole = slotIndex === effectiveLeadIndex ? 'lead' : 'worker';
    const permissionMode = slot.permissionMode || 'autonomous';
    const executionMode = slot.executionMode || 'local';

    const agentIdentity = existing || allAgents.find(a => a.name.toLowerCase() === slot.name.toLowerCase());
    const personaCtx: PersonaContext = {
      agentSoul: agentIdentity?.soul,
      agentMemory: agentIdentity?.memory,
      agentInstructions: agentIdentity?.instructions,
      officeSoul: office.soul,
      officeMemory: office.memory,
      officeInstructions: office.instructions,
      slotSoul: slot.soul,
      slotMemory: slot.memory,
      slotInstructions: slot.instructions,
    };

    // Create worktree if enabled
    let agentProjectPath = projectPath;
    let worktreeBranch: string | undefined;

    const worktreeMode = office.worktreeMode ?? 'per-agent';
    const slotUseWorktree = slot.useWorktree !== false;

    if (worktreeMode === 'per-agent' && slotUseWorktree && projectPath && isGitRepo(projectPath)) {
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const safeName = slot.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const branch = `swarm/${safeName}/${date}`;
      try {
        try {
          // Remove stale worktree from a previous shift on the same day
          removeWorktree(projectPath, branch);
        } catch {
          // Doesn't exist or already removed — fine
        }
        const wt = createWorktree(projectPath, branch);
        agentProjectPath = wt.path;
        worktreeBranch = branch;
        slotState.worktreeBranch = branch;
        slotState.worktreePath = wt.path;
      } catch (err) {
        console.warn(`Worktree creation failed for ${slot.name}, using shared checkout:`, err);
      }
    }

    const resolvedKeys = resolveKeysForSession(shift.officeId);
    spawnSession(
      sessionId, cliType, 80, 24, agent,
      executionMode, permissionMode, swarmRole,
      agentProjectPath, slot.functionalRole, office.pipeline, personaCtx,
      worktreeBranch, shift.officeId, slot.skills, resolvedKeys,
    );

    addMember({
      sessionId,
      officeId: shift.officeId,
      agentId: agent.id,
      agentName: agent.name,
      agentEmail: agent.email,
      cliType,
      executionMode,
      role: swarmRole,
      functionalRole: slot.functionalRole,
      joinedAt: new Date().toISOString(),
    });

    // Initialize cost tracking for on-demand spawned session
    initCostTracking(sessionId, agent.name, office.id, slot.budgetCents);

    swarmEvents.emit('session:spawned', {
      sessionId,
      officeId: shift.officeId,
      agentId: agent.id,
      agentName: agent.name,
      agentEmail: agent.email,
      cliType,
      executionMode,
      swarmRole,
      functionalRole: slot.functionalRole,
      worktreeBranch,
    });

    if (!slotState.pendingTimeouts) slotState.pendingTimeouts = [];
    if (cliType !== 'claude' && cliType !== 'bash') {
      const swarmApiUrl = executionMode === 'docker'
        ? `http://host.docker.internal:${PORT}`
        : `http://localhost:${PORT}`;
      const orientation = buildOrientationMessage(swarmRole, agent.name, sessionId, swarmApiUrl, agentProjectPath, worktreeBranch, slot.functionalRole, personaCtx);
      slotState.pendingTimeouts.push(setTimeout(() => injectMessage(sessionId, orientation), 2000));
    }

    slotState.status = 'active';
    slotState.sessionId = sessionId;
    emitShiftProgress(office.id, slotIndex, slot.name, 'active', sessionId);

    console.log(`On-demand spawned ${slot.name} (slot ${slotIndex})`);
    return slotState;

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    slotState.status = 'failed';
    slotState.error = message;
    emitShiftProgress(office.id, slotIndex, slot.name, 'failed', undefined, message);
    console.error(`On-demand spawn failed for ${slot.name}:`, message);
    return null;
  }
}

/** Rotate an agent by killing its session and respawning the slot */
export async function rotateAgent(sessionId: string, reason: string): Promise<void> {
  const shift = getShiftBySessionId(sessionId);
  if (!shift || shift.status !== 'active') return;

  const slotState = shift.slots.find(s => s.sessionId === sessionId);
  if (!slotState) return;

  console.log(`Rotating ${slotState.name}: ${reason}`);

  // 1. Ask agent to save state
  injectMessage(sessionId,
    `[SWARM SYSTEM]: Context rotation imminent — ${reason}. ` +
    `Please immediately save your current state:\n` +
    `swarm write handoff-${slotState.name.toLowerCase()}.md --content "` +
    `Current task: [what you're working on] / Progress: [what's done] / Next steps: [what to do next] / Key files: [files you've been editing]"\n` +
    `You have 30 seconds before respawn.`
  );

  // 2. Wait for handoff
  await new Promise(resolve => setTimeout(resolve, 30_000));

  // 3. Read handoff doc if written
  let handoffDoc: string | null = null;
  try {
    const result = await readFile(shift.officeId, `handoff-${slotState.name.toLowerCase()}.md`);
    if (result) handoffDoc = result.content;
  } catch { /* not written, that's ok */ }

  // 4. Reset retry count so handleSlotExit respawns cleanly
  slotState.retryCount = 0;

  // 5. Store handoff for injection after respawn
  (slotState as any).rotationHandoff = handoffDoc;

  // 6. Kill session — handleSlotExit will respawn
  killSession(sessionId);
}
