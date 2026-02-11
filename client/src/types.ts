export type CliType = 'bash' | 'claude' | 'gemini' | 'codex' | 'opencode';
export type ExecutionMode = 'local' | 'docker';
export type PermissionMode = 'autonomous' | 'regular';
export type SwarmRole = 'lead' | 'worker';

export interface SwarmMember {
  sessionId: string;
  agentId: string | null;
  agentName: string | null;
  agentEmail: string | null;
  cliType: CliType;
  executionMode: ExecutionMode;
  role: SwarmRole;
  joinedAt: string;
}

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
  executionMode: ExecutionMode;
  swarmRole: SwarmRole;
}

// WebSocket messages
export interface WsCreateMsg {
  type: 'create';
  requestId?: string;
  agentId?: string;
  agentName?: string;
  agentEmail?: string;
  cliType: CliType;
  executionMode?: ExecutionMode;
  permissionMode?: PermissionMode;
  swarmRole?: SwarmRole;
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

export interface WsSetRoleMsg {
  type: 'set-role';
  sessionId: string;
  role: SwarmRole;
}

export type ClientMessage = WsCreateMsg | WsInputMsg | WsResizeMsg | WsKillMsg | WsSetRoleMsg;

export interface WsCreatedMsg { type: 'created'; sessionId: string; requestId?: string; agentId: string | null; cliType: CliType }
export interface WsOutputMsg { type: 'output'; sessionId: string; data: string }
export interface WsExitedMsg { type: 'exited'; sessionId: string; exitCode: number }
export interface WsErrorMsg { type: 'error'; message: string }
export interface WsSwarmUpdateMsg { type: 'swarm:update'; members: SwarmMember[]; leadSessionId: string | null }
export interface WsSessionSpawnedMsg { type: 'session:spawned'; sessionId: string; agentId: string | null; agentName: string | null; agentEmail: string | null; cliType: CliType; executionMode: ExecutionMode; swarmRole: SwarmRole }
export interface WsSessionRestoreMsg { type: 'session:restore'; sessionId: string; agentId: string | null; agentName: string | null; agentEmail: string | null; cliType: CliType; executionMode: ExecutionMode; swarmRole: SwarmRole; scrollback?: string }

export type ServerMessage = WsCreatedMsg | WsOutputMsg | WsExitedMsg | WsErrorMsg | WsSwarmUpdateMsg | WsSessionSpawnedMsg | WsSessionRestoreMsg;
