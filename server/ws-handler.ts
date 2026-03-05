import type { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { spawnSession, resizeSession, killSession, sessions, PORT, MAX_SCROLLBACK } from './pty-manager.js';
import type { CliType, ExecutionMode, PtySession } from './pty-manager.js';
import { addMember, removeMember, setRole, getMembers, getLeadSessionId, getMember, swarmEvents } from './services/swarm-registry.js';
import type { SwarmRole, FunctionalRole } from './services/swarm-registry.js';
import { buildOrientationMessage } from './services/swarm-prompts.js';
import type { PersonaContext } from './services/swarm-prompts.js';
import { getAgent } from './services/agent-store.js';
import { getProjectPath, setProjectPath } from './routes/project.js';
import { registerSession, unregisterSession, injectMessage } from './services/pty-writer.js';
import { schedulePersistState } from './services/session-persistence.js';
import { handleSlotExit } from './services/shift-manager.js';
import { onCompaction } from './services/context-monitor.js';
import { releaseSessionCheckouts } from './services/task-board.js';
import { parseCostFromOutput, removeCostTracking } from './services/cost-tracker.js';
import { cleanupSkillDir } from './services/skill-injector.js';
import { resolveKeysForSession } from './services/key-store.js';

type PermissionMode = 'autonomous' | 'regular';
interface CreateMsg { type: 'create'; requestId?: string; agentId?: string; agentName?: string; agentEmail?: string; cliType: CliType; executionMode?: ExecutionMode; permissionMode?: PermissionMode; swarmRole?: SwarmRole; functionalRole?: FunctionalRole | null; projectPath?: string; cols: number; rows: number }
interface InputMsg { type: 'input'; sessionId: string; data: string }
interface ResizeMsg { type: 'resize'; sessionId: string; cols: number; rows: number }
interface KillMsg { type: 'kill'; sessionId: string }
interface SetRoleMsg { type: 'set-role'; sessionId: string; role: SwarmRole }
interface SetProjectPathMsg { type: 'set-project-path'; projectPath: string; officeId?: string }
interface InjectMsg { type: 'inject'; sessionId: string; text: string }
interface SubscribeMsg { type: 'subscribe'; officeIds: string[] }

type ClientMessage = CreateMsg | InputMsg | ResizeMsg | KillMsg | SetRoleMsg | SetProjectPathMsg | InjectMsg | SubscribeMsg;

// Track all connected browser clients for broadcasting swarm updates
interface ClientState {
  ws: WebSocket;
  subscribedOffices: Set<string>;
}
const connectedClients = new Map<WebSocket, ClientState>();
const sessionBridges = new Set<string>();

function send(ws: WebSocket, data: unknown): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastToOffice(officeId: string, payload: unknown): void {
  for (const [ws, state] of connectedClients) {
    if (state.subscribedOffices.has(officeId) || state.subscribedOffices.size === 0) {
      send(ws, payload);
    }
  }
}

function broadcastToAll(payload: unknown): void {
  for (const [ws] of connectedClients) {
    send(ws, payload);
  }
}

function broadcastSwarmUpdate(officeId?: string): void {
  if (officeId) {
    const officeMembers = Array.from(getMembers()).filter(m => m.officeId === officeId);
    const officeLead = officeMembers.find(m => m.role === 'lead')?.sessionId ?? null;
    const payload = {
      type: 'swarm:update',
      officeId,
      members: officeMembers,
      leadSessionId: officeLead,
    };
    broadcastToOffice(officeId, payload);
  } else {
    // Fallback: broadcast all members to all clients (backward compat)
    const payload = {
      type: 'swarm:update',
      members: getMembers(),
      leadSessionId: getLeadSessionId(),
    };
    broadcastToAll(payload);
  }
}

// Emit swarm updates to all browser clients when membership changes
swarmEvents.on('member:joined', (member) => {
  broadcastSwarmUpdate(member.officeId);
  schedulePersistState();
});
swarmEvents.on('member:left', (member) => {
  broadcastSwarmUpdate(member.officeId);
  schedulePersistState();
});
swarmEvents.on('member:role-changed', (member) => {
  broadcastSwarmUpdate(member.officeId);
  schedulePersistState();
});

// Broadcast shift progress to browser clients, scoped by office
swarmEvents.on('shift:progress', (data) => {
  const officeId = data.officeId;
  if (officeId) {
    broadcastToOffice(officeId, { type: 'shift:progress', ...data });
  } else {
    broadcastToAll({ type: 'shift:progress', ...data });
  }
});
swarmEvents.on('shift:status', (data) => {
  const officeId = data.shift?.officeId;
  if (officeId) {
    broadcastToOffice(officeId, { type: 'shift:status', ...data });
  } else {
    broadcastToAll({ type: 'shift:status', ...data });
  }
});

// Broadcast cost updates to all browser clients
swarmEvents.on('cost:update', (data) => {
  for (const [ws] of connectedClients) {
    send(ws, { type: 'cost:update', ...data });
  }
});

// Notify agents via PTY when their role changes
swarmEvents.on('member:role-changed', (member) => {
  const session = sessions.get(member.sessionId);
  if (!session) return;

  const roleLabel = member.role === 'lead' ? 'LEAD' : 'WORKER';
  const instruction = member.role === 'lead'
    ? 'You are now the lead. Coordinate the swarm — check who is available with curl, delegate tasks, and synthesize results.'
    : 'You are now a worker. Wait for instructions from the lead agent.';
  const msg = `[SWARM SYSTEM]: Your role has changed to ${roleLabel}. ${instruction}`;
  injectMessage(member.sessionId, msg);
});

function accumScrollback(session: PtySession, data: string): void {
  session.scrollback += data;
  session.totalOutputBytes += data.length;
  if (session.scrollback.length > MAX_SCROLLBACK) {
    session.scrollback = session.scrollback.slice(-MAX_SCROLLBACK);
  }
  session.lastDataAt = new Date();

  // Detect compaction events
  if (/[Cc]ompacted/.test(data)) {
    session.compactionCount++;
    onCompaction(session.id, session.compactionCount);
  }

  // Detect cost updates from Claude Code output
  parseCostFromOutput(session.id, data);

  schedulePersistState();
}

function bridgeSession(sessionId: string): void {
  if (sessionBridges.has(sessionId)) return;
  const session = sessions.get(sessionId);
  if (!session) return;

  sessionBridges.add(sessionId);
  registerSession(sessionId, session.pty);

  session.pty.onData((data: string) => {
    accumScrollback(session, data);
    if (session.officeId) {
      broadcastToOffice(session.officeId, { type: 'output', sessionId, data });
    } else {
      for (const [ws] of connectedClients) {
        send(ws, { type: 'output', sessionId, data });
      }
    }
  });

  session.pty.onExit(({ exitCode }: { exitCode: number }) => {
    // Release any task checkout locks held by this session
    const member = getMember(sessionId);
    releaseSessionCheckouts(sessionId).then(releasedTaskIds => {
      if (releasedTaskIds.length > 0) {
        console.log(`Auto-released ${releasedTaskIds.length} checkout(s) for exited session ${sessionId}`);
        const leadId = getLeadSessionId();
        if (leadId && leadId !== sessionId) {
          injectMessage(leadId,
            `[SWARM SYSTEM]: ${member?.agentName || sessionId} exited. ` +
            `Auto-released checkout locks on task(s): ${releasedTaskIds.join(', ')}. ` +
            `These tasks are available for reassignment.`
          );
        }
      }
    }).catch(err => console.error('Failed to release session checkouts:', err));

    // Clean up skill dir before respawn creates a new one
    cleanupSkillDir(sessionId);

    // Try auto-respawn if this session belongs to an active shift
    handleSlotExit(sessionId, exitCode).catch(err => {
      console.error('handleSlotExit error:', err);
    });

    // Clean up cost tracking for this session
    removeCostTracking(sessionId);

    unregisterSession(sessionId);
    sessionBridges.delete(sessionId);
    broadcastToAll({ type: 'exited', sessionId, exitCode });
    sessions.delete(sessionId);
    removeMember(sessionId);
    schedulePersistState();
  });
}

export function activateSessionStreaming(): void {
  for (const [sessionId] of sessions) {
    bridgeSession(sessionId);
  }
}

// Handle server-spawned sessions (from POST /api/swarm/spawn)
// Route PTY output to connected browser clients and notify them to create a tile
swarmEvents.on('session:spawned', ({ sessionId, agentId, agentName, agentEmail, cliType, executionMode, swarmRole, functionalRole, worktreeBranch, officeId }) => {
  if (!sessions.has(sessionId)) return;
  bridgeSession(sessionId);

  const payload = { type: 'session:spawned', sessionId, agentId, agentName, agentEmail, cliType, executionMode, swarmRole, functionalRole: functionalRole || null, worktreeBranch: worktreeBranch || null, officeId: officeId || null };
  if (officeId) {
    broadcastToOffice(officeId, payload);
  } else {
    broadcastToAll(payload);
  }
});

// Forward office notifications to all browser clients
swarmEvents.on('office:notification', (notification) => {
  broadcastToAll({ type: 'office:notification', notification });
});

export function handleWebSocket(ws: WebSocket): void {
  // Restore existing sessions before going live
  for (const [sessionId, session] of sessions) {
    bridgeSession(sessionId);
    const member = getMember(sessionId);
    send(ws, {
      type: 'session:restore',
      sessionId,
      agentId: session.agentId,
      agentName: session.agentName,
      agentEmail: session.agentEmail,
      cliType: session.cliType,
      executionMode: session.executionMode,
      swarmRole: member?.role || 'worker',
      functionalRole: member?.functionalRole || null,
      worktreeBranch: session.worktreeBranch || null,
      officeId: session.officeId || null,
      scrollback: session.scrollback || undefined,
    });
  }

  // Send current swarm state
  send(ws, {
    type: 'swarm:update',
    members: getMembers(),
    leadSessionId: getLeadSessionId(),
  });

  // NOW add to connectedClients — real-time output starts flowing
  connectedClients.set(ws, { ws, subscribedOffices: new Set() });

  ws.on('message', async (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    switch (msg.type) {
      case 'create': {
        const sessionId = randomUUID();
        const agent = msg.agentId ? {
          id: msg.agentId,
          name: msg.agentName || 'Unknown',
          email: msg.agentEmail || '',
        } : null;
        const swarmRole: SwarmRole = msg.swarmRole || 'worker';

        // Look up full agent identity for innate persona context
        let personaCtx: PersonaContext | undefined;
        if (msg.agentId) {
          const fullAgent = await getAgent(msg.agentId);
          if (fullAgent && (fullAgent.soul || fullAgent.memory || fullAgent.instructions)) {
            personaCtx = {
              agentSoul: fullAgent.soul,
              agentMemory: fullAgent.memory,
              agentInstructions: fullAgent.instructions,
            };
          }
        }

        // Use per-session project path if provided, otherwise fall back to global
        const effectivePath = msg.projectPath || getProjectPath();

        const resolvedKeys = resolveKeysForSession('');  // ad-hoc, no office
        try {
          spawnSession(sessionId, msg.cliType, msg.cols, msg.rows, agent, msg.executionMode, msg.permissionMode, swarmRole, effectivePath || undefined, msg.functionalRole, undefined, personaCtx, undefined, undefined, undefined, resolvedKeys);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Failed to spawn terminal';
          console.error(`PTY spawn failed for ${msg.cliType}:`, message);
          send(ws, { type: 'error', message: `Failed to launch ${msg.cliType}: ${message}` });
          return;
        }

        bridgeSession(sessionId);

        // Register in swarm
        addMember({
          sessionId,
          officeId: '',  // ad-hoc session, not part of any office
          agentId: agent?.id ?? null,
          agentName: agent?.name ?? null,
          agentEmail: agent?.email ?? null,
          cliType: msg.cliType,
          executionMode: msg.executionMode || 'local',
          role: swarmRole,
          functionalRole: msg.functionalRole || null,
          joinedAt: new Date().toISOString(),
        });

        // For non-Claude agents, inject swarm orientation after a short delay
        if (msg.cliType !== 'claude' && msg.cliType !== 'bash') {
          const swarmApiUrl = msg.executionMode === 'docker'
            ? `http://host.docker.internal:${PORT}`
            : `http://localhost:${PORT}`;
          const orientation = buildOrientationMessage(swarmRole, agent?.name ?? null, sessionId, swarmApiUrl, effectivePath || undefined, undefined, msg.functionalRole, personaCtx);
          setTimeout(() => {
            injectMessage(sessionId, orientation);
          }, 500);
        }

        send(ws, { type: 'created', sessionId, requestId: msg.requestId, agentId: msg.agentId || null, cliType: msg.cliType });
        break;
      }

      case 'input': {
        const session = sessions.get(msg.sessionId);
        if (session) {
          session.pty.write(msg.data);
        }
        break;
      }

      case 'resize': {
        resizeSession(msg.sessionId, msg.cols, msg.rows);
        schedulePersistState();
        break;
      }

      case 'kill': {
        // Release checkout locks before killing the session
        releaseSessionCheckouts(msg.sessionId).then(releasedTaskIds => {
          if (releasedTaskIds.length > 0) {
            console.log(`Released ${releasedTaskIds.length} checkout(s) for killed session ${msg.sessionId}`);
          }
        }).catch(err => console.error('Failed to release session checkouts on kill:', err));
        cleanupSkillDir(msg.sessionId);
        killSession(msg.sessionId);
        removeCostTracking(msg.sessionId);
        removeMember(msg.sessionId);
        sessionBridges.delete(msg.sessionId);
        unregisterSession(msg.sessionId);
        schedulePersistState();
        break;
      }

      case 'set-role': {
        setRole(msg.sessionId, msg.role);
        break;
      }

      case 'set-project-path': {
        if (msg.officeId) {
          // Scope to office — update the office's projectPath (persists to disk)
          const { getOffice, saveOffice } = await import('./services/office-store.js');
          const office = await getOffice(msg.officeId);
          if (office) {
            office.projectPath = msg.projectPath;
            office.updatedAt = new Date().toISOString();
            await saveOffice(office);
          }
        } else {
          // No office context — set the global path (for ad-hoc terminals)
          setProjectPath(msg.projectPath);
        }
        schedulePersistState();
        break;
      }

      case 'inject': {
        injectMessage(msg.sessionId, msg.text);
        break;
      }

      case 'subscribe': {
        const state = connectedClients.get(ws);
        if (state) {
          state.subscribedOffices.clear();
          for (const id of msg.officeIds) {
            state.subscribedOffices.add(id);
          }
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    connectedClients.delete(ws);
  });
}
