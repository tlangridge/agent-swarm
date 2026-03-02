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

export type ShiftSlotStatus = 'pending' | 'booting' | 'active' | 'failed' | 'ended';
export type ShiftStatus = 'starting' | 'active' | 'review' | 'ending' | 'ended';

export interface ShiftSlotState {
  slotIndex: number;
  name: string;
  functionalRole: FunctionalRole;
  status: ShiftSlotStatus;
  sessionId?: string;
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

  // Boot agents sequentially with stagger
  for (let i = 0; i < office.slots.length; i++) {
    const slot = office.slots[i];
    const slotState = shift.slots[i];

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

      spawnSession(
        sessionId, cliType, 80, 24, agent,
        executionMode, permissionMode, swarmRole,
        projectPath, slot.functionalRole, office.pipeline, personaCtx,
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
      });

      // For non-Claude/non-bash agents, inject orientation after the CLI has initialized
      if (cliType !== 'claude' && cliType !== 'bash') {
        const swarmApiUrl = executionMode === 'docker'
          ? `http://host.docker.internal:${PORT}`
          : `http://localhost:${PORT}`;
        const orientation = buildOrientationMessage(swarmRole, agent.name, sessionId, swarmApiUrl, projectPath, undefined, slot.functionalRole, personaCtx);
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

      spawnSession(
        newSessionId, cliType, 80, 24, agent,
        slot.executionMode || 'local', slot.permissionMode || 'autonomous', swarmRole,
        projectPath, slot.functionalRole, office.pipeline, personaCtx,
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
      });

      // Inject orientation for non-Claude/non-bash agents (2s delay for CLI init)
      if (cliType !== 'claude' && cliType !== 'bash') {
        const swarmApiUrl = (slot.executionMode || 'local') === 'docker'
          ? `http://host.docker.internal:${PORT}`
          : `http://localhost:${PORT}`;
        const orientation = buildOrientationMessage(swarmRole, agent.name, newSessionId, swarmApiUrl, projectPath, undefined, slot.functionalRole, personaCtx);
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
