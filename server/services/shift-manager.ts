import { randomUUID } from 'crypto';
import { nanoid } from 'nanoid';
import type { Office, OfficeSlot, PipelineStage } from './office-store.js';
import { getOffice } from './office-store.js';
import { fireWebhook } from './webhooks.js';
import type { FunctionalRole, SwarmRole } from './swarm-registry.js';
import { addMember, removeMember, getMemberByName, getMembers, swarmEvents } from './swarm-registry.js';
import { listAgents, saveAgent } from './agent-store.js';
import { provisionInbox } from './agentmail.js';
import { spawnSession, sessions, killSession, PORT } from '../pty-manager.js';
import type { CliType } from '../pty-manager.js';
import { buildOrientationMessage } from './swarm-prompts.js';
import type { PersonaContext } from './swarm-prompts.js';
import { injectMessage } from './pty-writer.js';
import { startScheduler, stopScheduler } from './cron-scheduler.js';
import { getProjectPath } from '../routes/project.js';
import { isGitRepo, createWorktree } from './worktree.js';

export type ShiftSlotStatus = 'pending' | 'booting' | 'active' | 'failed' | 'ended';
export type ShiftStatus = 'starting' | 'active' | 'review' | 'ending' | 'ended';

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
}

export interface ShiftState {
  officeId: string;
  officeName: string;
  startedAt: string;
  status: ShiftStatus;
  slots: ShiftSlotState[];
  reviewSummary?: string;
}

let activeShift: ShiftState | null = null;

export function getActiveShift(): ShiftState | null {
  return activeShift;
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

export async function badgeIn(office: Office, broadcast: (data: unknown) => void): Promise<ShiftState> {
  if (activeShift && activeShift.status !== 'ended') {
    throw new Error('A shift is already active. Badge out first.');
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
  activeShift = shift;
  emitShiftStatus(shift);

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
    const existingMember = getMemberByName(slot.name);
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
          const wt = createWorktree(projectPath, branch);
          agentProjectPath = wt.path;
          worktreeBranch = branch;
          slotState.worktreeBranch = branch;
          slotState.worktreePath = wt.path;
        } catch (err) {
          console.warn(`Worktree creation failed for ${slot.name}, using shared checkout:`, err);
        }
      }

      spawnSession(
        sessionId, cliType, 80, 24, agent,
        executionMode, permissionMode, swarmRole,
        agentProjectPath, slot.functionalRole, office.pipeline, personaCtx,
        worktreeBranch,
      );

      addMember({
        sessionId,
        agentId: agent.id,
        agentName: agent.name,
        agentEmail: agent.email,
        cliType,
        executionMode,
        role: swarmRole,
        functionalRole: slot.functionalRole,
        joinedAt: new Date().toISOString(),
      });

      // Emit session:spawned for ws-handler to bridge output + create tile
      swarmEvents.emit('session:spawned', {
        sessionId,
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
      if (cliType !== 'claude' && cliType !== 'bash') {
        const swarmApiUrl = executionMode === 'docker'
          ? `http://host.docker.internal:${PORT}`
          : `http://localhost:${PORT}`;
        const orientation = buildOrientationMessage(swarmRole, agent.name, sessionId, swarmApiUrl, agentProjectPath, worktreeBranch, slot.functionalRole, personaCtx);
        setTimeout(() => injectMessage(sessionId, orientation), 2000);
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

  // Start cron scheduler
  const resolveTargets = (job: { targetAgent?: string; targetRole?: FunctionalRole }) => {
    const members = getMembers();
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

    // Instructions
    kickoffParts.push(
      '\nUse the `swarm` CLI for team coordination. Run `swarm help` for available commands.',
      '\nStart by:',
      '1. Read existing context: `swarm context`',
      '2. Check current tasks: `swarm tasks`',
      '3. If no tasks exist, wait for the user\'s mission, then break it into tasks and assign them.',
    );

    const kickoff = kickoffParts.join('\n');
    setTimeout(() => injectMessage(leadSlot.sessionId!, kickoff), 3000);
  }

  // Send "stand by" message to ALL worker agents so they don't start working prematurely
  const workerSlots = shift.slots.filter((s, i) => s.status === 'active' && s.sessionId && i !== effectiveLeadIndex);
  if (workerSlots.length > 0) {
    const standbyMsg = [
      '[SWARM SYSTEM]: Shift started. You are a worker agent.',
      'STAND BY — do NOT start any work yet.',
      'The lead is setting up the mission and will assign you tasks shortly.',
      'While you wait:',
      '  1. Run `swarm tasks --mine` to check for pre-assigned tasks',
      '  2. Run `swarm context` to read the workspace context',
      '  3. If you have no tasks, WAIT for a message from the lead.',
      'Do NOT explore the codebase, write code, or take any action until you have a task.',
    ].join('\n');
    setTimeout(() => {
      for (const slot of workerSlots) {
        injectMessage(slot.sessionId!, standbyMsg);
      }
    }, 4000);
  }

  return shift;
}

export async function badgeOut(): Promise<ShiftState | null> {
  if (!activeShift) return null;

  stopScheduler();
  stopIdleMonitor();
  activeShift.status = 'ending';
  emitShiftStatus(activeShift);

  // Kill all sessions known to the shift
  for (const slot of activeShift.slots) {
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

  // Clean up any orphaned members left in the registry (e.g. from UI restarts
  // that created sessions the shift-manager doesn't track)
  for (const member of getMembers()) {
    removeMember(member.sessionId);
  }

  // Log preserved worktrees for human review
  const worktreeSummary = activeShift.slots
    .filter(s => s.worktreeBranch)
    .map(s => `  ${s.name}: ${s.worktreeBranch}`)
    .join('\n');
  if (worktreeSummary) {
    console.log(`Shift worktrees preserved:\n${worktreeSummary}`);
  }

  activeShift.status = 'ended';
  emitShiftStatus(activeShift);
  fireWebhook('shift:ended', { officeId: activeShift.officeId, officeName: activeShift.officeName });

  const ended = activeShift;
  activeShift = null;
  return ended;
}

export async function handleSlotExit(sessionId: string, exitCode: number): Promise<void> {
  if (!activeShift || activeShift.status !== 'active') return;

  const slotState = activeShift.slots.find(s => s.sessionId === sessionId);
  if (!slotState) return;

  const retries = slotState.retryCount || 0;

  // Only respawn on non-zero exit (crash) with retries remaining
  if (exitCode !== 0 && retries < 3) {
    slotState.retryCount = retries + 1;
    slotState.status = 'booting';
    emitShiftProgress(activeShift.officeId, slotState.slotIndex, slotState.name, 'booting');

    try {
      const office = await getOffice(activeShift.officeId);
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

      spawnSession(
        newSessionId, cliType, 80, 24, agent,
        slot.executionMode || 'local', slot.permissionMode || 'autonomous', swarmRole,
        respawnProjectPath, slot.functionalRole, office.pipeline, personaCtx,
        respawnWorktreeBranch,
      );

      addMember({
        sessionId: newSessionId,
        agentId: agent.id,
        agentName: agent.name,
        agentEmail: agent.email,
        cliType,
        executionMode: slot.executionMode || 'local',
        role: swarmRole,
        functionalRole: slot.functionalRole,
        joinedAt: new Date().toISOString(),
      });

      swarmEvents.emit('session:spawned', {
        sessionId: newSessionId,
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
      if (cliType !== 'claude' && cliType !== 'bash') {
        const swarmApiUrl = (slot.executionMode || 'local') === 'docker'
          ? `http://host.docker.internal:${PORT}`
          : `http://localhost:${PORT}`;
        const orientation = buildOrientationMessage(swarmRole, agent.name, newSessionId, swarmApiUrl, respawnProjectPath, respawnWorktreeBranch, slot.functionalRole, personaCtx);
        setTimeout(() => injectMessage(newSessionId, orientation), 2000);
      }

      slotState.sessionId = newSessionId;
      slotState.status = 'active';
      slotState.error = undefined;
      emitShiftProgress(activeShift.officeId, slotState.slotIndex, slotState.name, 'active', newSessionId);
      fireWebhook('agent:respawned', { agentName: slotState.name, retryCount: slotState.retryCount, newSessionId });

      console.log(`Auto-respawned ${slot.name} (attempt ${slotState.retryCount}/3)`);

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      slotState.status = 'failed';
      slotState.error = `Respawn failed: ${message}`;
      emitShiftProgress(activeShift.officeId, slotState.slotIndex, slotState.name, 'failed', undefined, slotState.error);
      fireWebhook('agent:failed', { agentName: slotState.name, error: slotState.error, retryCount: slotState.retryCount });
      console.error(`Auto-respawn failed for ${slotState.name}:`, message);
    }
  } else {
    slotState.status = 'ended';
    emitShiftProgress(activeShift.officeId, slotState.slotIndex, slotState.name, 'ended');
  }
}

export function markReadyForReview(sessionId: string, summary: string): { success: boolean; error?: string } {
  if (!activeShift || activeShift.status !== 'active') {
    return { success: false, error: 'No active shift' };
  }

  const callerSlot = activeShift.slots.find(s => s.sessionId === sessionId);
  if (!callerSlot) {
    return { success: false, error: 'Session not part of active shift' };
  }

  const leadIndex = activeShift.slots.findIndex(s => s.functionalRole === 'tech-lead');
  const effectiveLeadIndex = leadIndex >= 0 ? leadIndex : 0;
  if (callerSlot.slotIndex !== effectiveLeadIndex) {
    return { success: false, error: 'Only the lead agent can mark shift as ready for review' };
  }

  activeShift.status = 'review';
  activeShift.reviewSummary = summary;
  emitShiftStatus(activeShift);
  fireWebhook('shift:ready-for-review', {
    officeId: activeShift.officeId,
    officeName: activeShift.officeName,
    summary,
  });
  return { success: true };
}

// --- Idle auto-dismiss ---
let idleMonitorTimer: ReturnType<typeof setInterval> | null = null;

export function startIdleMonitor(office: Office): void {
  const minutes = office.idleDismissMinutes ?? 0;
  if (minutes <= 0) return;

  stopIdleMonitor();
  const thresholdMs = minutes * 60 * 1000;

  idleMonitorTimer = setInterval(async () => {
    if (!activeShift || activeShift.status !== 'active') return;

    const leadIndex = office.slots.findIndex(s => s.functionalRole === 'tech-lead');
    const effectiveLeadIndex = leadIndex >= 0 ? leadIndex : 0;
    const { listTasks } = await import('./task-board.js');

    for (const slotState of activeShift.slots) {
      if (slotState.status !== 'active' || !slotState.sessionId) continue;
      if (slotState.slotIndex === effectiveLeadIndex) continue; // never dismiss lead

      const session = sessions.get(slotState.sessionId);
      if (!session) continue;

      const idleMs = Date.now() - session.lastDataAt.getTime();
      if (idleMs < thresholdMs) continue;

      // Check if agent has any open or in-progress tasks
      const agentTasks = await listTasks({
        assignedTo: slotState.name,
        officeId: activeShift.officeId,
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
      emitShiftProgress(activeShift.officeId, slotState.slotIndex, slotState.name, 'ended');
      fireWebhook('agent:dismissed', { agentName: slotState.name, reason: 'idle', idleMinutes: minutes });

      // Notify lead
      const leadSlot = activeShift.slots[effectiveLeadIndex];
      if (leadSlot?.sessionId) {
        injectMessage(leadSlot.sessionId, `[SWARM SYSTEM]: ${slotState.name} auto-dismissed after ${minutes}m idle with no tasks.`);
      }

      console.log(`Auto-dismissed ${slotState.name} after ${minutes}m idle`);
    }
  }, 60_000); // check every 60s
}

export function stopIdleMonitor(): void {
  if (idleMonitorTimer) {
    clearInterval(idleMonitorTimer);
    idleMonitorTimer = null;
  }
}

/** Spawn a single pending (unbooted) slot on demand */
export async function spawnSlotOnDemand(slotIndex: number): Promise<ShiftSlotState | null> {
  if (!activeShift || activeShift.status !== 'active') return null;
  const slotState = activeShift.slots[slotIndex];
  if (!slotState || slotState.status !== 'pending') return null;

  const office = await getOffice(activeShift.officeId);
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
        const wt = createWorktree(projectPath, branch);
        agentProjectPath = wt.path;
        worktreeBranch = branch;
        slotState.worktreeBranch = branch;
        slotState.worktreePath = wt.path;
      } catch (err) {
        console.warn(`Worktree creation failed for ${slot.name}, using shared checkout:`, err);
      }
    }

    spawnSession(
      sessionId, cliType, 80, 24, agent,
      executionMode, permissionMode, swarmRole,
      agentProjectPath, slot.functionalRole, office.pipeline, personaCtx,
      worktreeBranch,
    );

    addMember({
      sessionId,
      agentId: agent.id,
      agentName: agent.name,
      agentEmail: agent.email,
      cliType,
      executionMode,
      role: swarmRole,
      functionalRole: slot.functionalRole,
      joinedAt: new Date().toISOString(),
    });

    swarmEvents.emit('session:spawned', {
      sessionId,
      agentId: agent.id,
      agentName: agent.name,
      agentEmail: agent.email,
      cliType,
      executionMode,
      swarmRole,
      functionalRole: slot.functionalRole,
      worktreeBranch,
    });

    if (cliType !== 'claude' && cliType !== 'bash') {
      const swarmApiUrl = executionMode === 'docker'
        ? `http://host.docker.internal:${PORT}`
        : `http://localhost:${PORT}`;
      const orientation = buildOrientationMessage(swarmRole, agent.name, sessionId, swarmApiUrl, agentProjectPath, worktreeBranch, slot.functionalRole, personaCtx);
      setTimeout(() => injectMessage(sessionId, orientation), 2000);
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
