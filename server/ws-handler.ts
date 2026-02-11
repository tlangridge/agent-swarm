import type { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { spawnSession, resizeSession, killSession, sessions, PORT, MAX_SCROLLBACK } from './pty-manager.js';
import type { CliType, ExecutionMode } from './pty-manager.js';
import { addMember, removeMember, setRole, getMembers, getLeadSessionId, getMember, swarmEvents } from './services/swarm-registry.js';
import type { SwarmRole } from './services/swarm-registry.js';
import { buildOrientationMessage } from './services/swarm-prompts.js';

type PermissionMode = 'autonomous' | 'regular';
interface CreateMsg { type: 'create'; requestId?: string; agentId?: string; agentName?: string; agentEmail?: string; cliType: CliType; executionMode?: ExecutionMode; permissionMode?: PermissionMode; swarmRole?: SwarmRole; cols: number; rows: number }
interface InputMsg { type: 'input'; sessionId: string; data: string }
interface ResizeMsg { type: 'resize'; sessionId: string; cols: number; rows: number }
interface KillMsg { type: 'kill'; sessionId: string }
interface SetRoleMsg { type: 'set-role'; sessionId: string; role: SwarmRole }

type ClientMessage = CreateMsg | InputMsg | ResizeMsg | KillMsg | SetRoleMsg;

// Track all connected browser clients for broadcasting swarm updates
const connectedClients = new Set<WebSocket>();

function send(ws: WebSocket, data: unknown): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastSwarmUpdate(): void {
  const payload = {
    type: 'swarm:update',
    members: getMembers(),
    leadSessionId: getLeadSessionId(),
  };
  for (const client of connectedClients) {
    send(client, payload);
  }
}

// Emit swarm updates to all browser clients when membership changes
swarmEvents.on('member:joined', broadcastSwarmUpdate);
swarmEvents.on('member:left', broadcastSwarmUpdate);
swarmEvents.on('member:role-changed', broadcastSwarmUpdate);

// Notify agents via PTY when their role changes
swarmEvents.on('member:role-changed', (member) => {
  const session = sessions.get(member.sessionId);
  if (!session) return;

  const roleLabel = member.role === 'lead' ? 'LEAD' : 'WORKER';
  const instruction = member.role === 'lead'
    ? 'You are now the lead. Coordinate the swarm — check who is available with curl, delegate tasks, and synthesize results.'
    : 'You are now a worker. Wait for instructions from the lead agent.';
  const msg = `[SWARM SYSTEM]: Your role has changed to ${roleLabel}. ${instruction}`;
  session.pty.write(msg);
  setTimeout(() => session.pty.write('\r'), 100);
});

function accumScrollback(session: { scrollback: string }, data: string): void {
  session.scrollback += data;
  if (session.scrollback.length > MAX_SCROLLBACK) {
    session.scrollback = session.scrollback.slice(-MAX_SCROLLBACK);
  }
}

// Handle server-spawned sessions (from POST /api/swarm/spawn)
// Route PTY output to all connected browser clients and notify them to create a tile
swarmEvents.on('session:spawned', ({ sessionId, agentId, agentName, agentEmail, cliType, executionMode, swarmRole }) => {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Notify all clients to create a terminal tile
  for (const client of connectedClients) {
    send(client, { type: 'session:spawned', sessionId, agentId, agentName, agentEmail, cliType, executionMode, swarmRole });
  }

  // Broadcast PTY output to all connected clients + accumulate scrollback
  session.pty.onData((data: string) => {
    accumScrollback(session, data);
    for (const client of connectedClients) {
      send(client, { type: 'output', sessionId, data });
    }
  });

  // Broadcast exit to all clients and clean up
  session.pty.onExit(({ exitCode }: { exitCode: number }) => {
    for (const client of connectedClients) {
      send(client, { type: 'exited', sessionId, exitCode });
    }
    sessions.delete(sessionId);
    removeMember(sessionId);
  });
});

export function handleWebSocket(ws: WebSocket): void {
  // Restore existing sessions before going live
  for (const [sessionId, session] of sessions) {
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
  connectedClients.add(ws);

  ws.on('message', (raw) => {
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

        let session;
        try {
          session = spawnSession(sessionId, msg.cliType, msg.cols, msg.rows, agent, msg.executionMode, msg.permissionMode, swarmRole);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Failed to spawn terminal';
          console.error(`PTY spawn failed for ${msg.cliType}:`, message);
          send(ws, { type: 'error', message: `Failed to launch ${msg.cliType}: ${message}` });
          return;
        }

        // Register in swarm
        addMember({
          sessionId,
          agentId: agent?.id ?? null,
          agentName: agent?.name ?? null,
          agentEmail: agent?.email ?? null,
          cliType: msg.cliType,
          executionMode: msg.executionMode || 'local',
          role: swarmRole,
          joinedAt: new Date().toISOString(),
        });

        // For non-Claude agents, inject swarm orientation after a short delay
        if (msg.cliType !== 'claude' && msg.cliType !== 'bash') {
          const swarmApiUrl = msg.executionMode === 'docker'
            ? `http://host.docker.internal:${PORT}`
            : `http://localhost:${PORT}`;
          const orientation = buildOrientationMessage(swarmRole, agent?.name ?? null, sessionId, swarmApiUrl);
          setTimeout(() => {
            const s = sessions.get(sessionId);
            if (s) s.pty.write(orientation);
          }, 500);
        }

        session.pty.onData((data: string) => {
          accumScrollback(session, data);
          for (const client of connectedClients) {
            send(client, { type: 'output', sessionId, data });
          }
        });

        session.pty.onExit(({ exitCode }: { exitCode: number }) => {
          for (const client of connectedClients) {
            send(client, { type: 'exited', sessionId, exitCode });
          }
          sessions.delete(sessionId);
          removeMember(sessionId);
        });

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
        break;
      }

      case 'kill': {
        killSession(msg.sessionId);
        removeMember(msg.sessionId);
        break;
      }

      case 'set-role': {
        setRole(msg.sessionId, msg.role);
        break;
      }
    }
  });

  ws.on('close', () => {
    connectedClients.delete(ws);
  });
}
