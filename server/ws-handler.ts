import type { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { spawnSession, resizeSession, killSession, sessions, PORT } from './pty-manager.js';
import type { CliType, ExecutionMode } from './pty-manager.js';
import { addMember, removeMember, setRole, getMembers, getLeadSessionId, swarmEvents } from './services/swarm-registry.js';
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

// Handle server-spawned sessions (from POST /api/swarm/spawn)
// Route PTY output to all connected browser clients and notify them to create a tile
swarmEvents.on('session:spawned', ({ sessionId, agentId, agentName, agentEmail, cliType, executionMode, swarmRole }) => {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Notify all clients to create a terminal tile
  for (const client of connectedClients) {
    send(client, { type: 'session:spawned', sessionId, agentId, agentName, agentEmail, cliType, executionMode, swarmRole });
  }

  // Broadcast PTY output to all connected clients
  session.pty.onData((data: string) => {
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
  const clientSessions = new Set<string>();
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

        clientSessions.add(sessionId);

        session.pty.onData((data: string) => {
          send(ws, { type: 'output', sessionId, data });
        });

        session.pty.onExit(({ exitCode }: { exitCode: number }) => {
          send(ws, { type: 'exited', sessionId, exitCode });
          clientSessions.delete(sessionId);
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
        clientSessions.delete(msg.sessionId);
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
    for (const sessionId of clientSessions) {
      killSession(sessionId);
      removeMember(sessionId);
    }
  });
}
