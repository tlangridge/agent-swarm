import type { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { spawnSession, resizeSession, killSession, sessions } from './pty-manager.js';
import type { CliType, ExecutionMode } from './pty-manager.js';

type PermissionMode = 'autonomous' | 'regular';
interface CreateMsg { type: 'create'; requestId?: string; agentId?: string; agentName?: string; agentEmail?: string; cliType: CliType; executionMode?: ExecutionMode; permissionMode?: PermissionMode; cols: number; rows: number }
interface InputMsg { type: 'input'; sessionId: string; data: string }
interface ResizeMsg { type: 'resize'; sessionId: string; cols: number; rows: number }
interface KillMsg { type: 'kill'; sessionId: string }

type ClientMessage = CreateMsg | InputMsg | ResizeMsg | KillMsg;

function send(ws: WebSocket, data: unknown): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

export function handleWebSocket(ws: WebSocket): void {
  const clientSessions = new Set<string>();

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

        let session;
        try {
          session = spawnSession(sessionId, msg.cliType, msg.cols, msg.rows, agent, msg.executionMode, msg.permissionMode);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Failed to spawn terminal';
          console.error(`PTY spawn failed for ${msg.cliType}:`, message);
          send(ws, { type: 'error', message: `Failed to launch ${msg.cliType}: ${message}` });
          return;
        }

        clientSessions.add(sessionId);

        session.pty.onData((data: string) => {
          send(ws, { type: 'output', sessionId, data });
        });

        session.pty.onExit(({ exitCode }: { exitCode: number }) => {
          send(ws, { type: 'exited', sessionId, exitCode });
          clientSessions.delete(sessionId);
          sessions.delete(sessionId);
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
        break;
      }
    }
  });

  ws.on('close', () => {
    for (const sessionId of clientSessions) {
      killSession(sessionId);
    }
  });
}
