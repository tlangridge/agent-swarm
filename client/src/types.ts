export type CliType = 'bash' | 'claude' | 'gemini' | 'codex' | 'opencode';

export interface AgentIdentity {
  id: string;
  name: string;
  email: string;
  inboxId: string;
  credentials: Record<string, string>;
  defaultCliType: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TerminalSession {
  id: string;
  agentId: string | null;
  agentName: string | null;
  agentEmail: string | null;
  cliType: CliType;
}

// WebSocket messages
export interface WsCreateMsg {
  type: 'create';
  agentId?: string;
  agentName?: string;
  agentEmail?: string;
  cliType: CliType;
  cols: number;
  rows: number;
}

export interface WsInputMsg {
  type: 'input';
  sessionId: string;
  data: string;
}

export interface WsResizeMsg {
  type: 'resize';
  sessionId: string;
  cols: number;
  rows: number;
}

export interface WsKillMsg {
  type: 'kill';
  sessionId: string;
}

export type ClientMessage = WsCreateMsg | WsInputMsg | WsResizeMsg | WsKillMsg;

export interface WsCreatedMsg { type: 'created'; sessionId: string; agentId: string | null; cliType: CliType }
export interface WsOutputMsg { type: 'output'; sessionId: string; data: string }
export interface WsExitedMsg { type: 'exited'; sessionId: string; exitCode: number }
export interface WsErrorMsg { type: 'error'; message: string }

export type ServerMessage = WsCreatedMsg | WsOutputMsg | WsExitedMsg | WsErrorMsg;
