export type CliType = 'bash' | 'claude' | 'gemini' | 'codex' | 'opencode';
export type ExecutionMode = 'local' | 'docker';
export type PermissionMode = 'autonomous' | 'regular';
export type SwarmRole = 'lead' | 'worker';

export type FunctionalRole =
  | 'product-manager'
  | 'architect'
  | 'designer'
  | 'developer'
  | 'tester'
  | 'code-reviewer'
  | 'devops'
  | 'tech-lead';

export const FUNCTIONAL_ROLE_COLORS: Record<FunctionalRole, string> = {
  'product-manager': '#7aa2f7',  // blue
  'architect': '#bb9af7',        // purple
  'designer': '#b4f9f8',         // teal
  'developer': '#9ece6a',        // green
  'tester': '#ff9e64',           // orange
  'code-reviewer': '#e0af68',    // yellow
  'devops': '#f7768e',           // red
  'tech-lead': '#2ac3de',        // cyan
};

export const FUNCTIONAL_ROLE_LABELS: Record<FunctionalRole, string> = {
  'product-manager': 'PM',
  'architect': 'Architect',
  'designer': 'Designer',
  'developer': 'Developer',
  'tester': 'Tester',
  'code-reviewer': 'Reviewer',
  'devops': 'DevOps',
  'tech-lead': 'Tech Lead',
};

export interface SwarmMember {
  sessionId: string;
  agentId: string | null;
  agentName: string | null;
  agentEmail: string | null;
  cliType: CliType;
  executionMode: ExecutionMode;
  role: SwarmRole;
  functionalRole: FunctionalRole | null;
  joinedAt: string;
  officeId?: string;
}

// --- Office types ---

export interface PipelineStage {
  name: string;
  description: string;
  assignedRoles: FunctionalRole[];
}

export interface OfficeSlot {
  name: string;
  functionalRole: FunctionalRole;
  cliType: CliType;
  permissionMode?: PermissionMode;
  executionMode?: ExecutionMode;
  useWorktree?: boolean;
  autoSpawn?: boolean;
  soul?: string;
  memory?: string;
  instructions?: string;
  skills?: string[];
}

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  targetRole?: FunctionalRole;
  targetAgent?: string;
  prompt: string;
  enabled: boolean;
  createdBy: string;
  lastRun?: string;
}

export interface Office {
  id: string;
  name: string;
  slots: OfficeSlot[];
  pipeline?: PipelineStage[];
  cronJobs?: CronJob[];
  projectPath?: string;
  worktreeMode?: 'per-agent' | 'shared' | 'disabled';
  spawnMode?: 'eager' | 'demand';
  idleDismissMinutes?: number;
  soul?: string;
  memory?: string;
  instructions?: string;
  nextShiftNumber?: number;
  createdAt: string;
  updatedAt: string;
}

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
}

export interface TaskItem {
  id: string;
  title: string;
  description?: string;
  stage: string;
  assignedTo?: string;
  createdBy: string;
  status: 'open' | 'in-progress' | 'blocked' | 'done';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  context?: string;
  tags?: string[];
  parentTask?: string;
  dependsOn?: string[];
  output?: string;
  shiftId?: string;
  officeId?: string;
  branch?: string;
  prNumber?: number;
  prUrl?: string;
  issueNumber?: number;
  issueUrl?: string;
  checkoutSessionId?: string;
  checkoutAgentName?: string;
  checkedOutAt?: string;
  checkoutLive?: boolean;
  checkoutStale?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentIdentity {
  id: string;
  name: string;
  email: string;
  inboxId: string;
  credentials: Record<string, string>;
  defaultCliType: string | null;
  soul?: string;
  memory?: string;
  instructions?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Worktree {
  path: string;
  branch: string;
  head: string;
  isMain: boolean;
}

export type WorktreeChangeStatus = 'M' | 'A' | 'D' | 'R' | '??' | 'U';

export interface WorktreeChangeEntry {
  status: WorktreeChangeStatus;
  path: string;
  oldPath?: string;
}

export interface WorktreeOverviewTotals {
  changed: number;
  modified: number;
  added: number;
  deleted: number;
  renamed: number;
  untracked: number;
  conflicted: number;
}

export interface WorktreeOverviewAgent {
  sessionId: string;
  agentId: string | null;
  agentName: string | null;
  role: SwarmRole;
  cliType: CliType;
}

export interface WorktreeOverviewItem {
  path: string;
  branch: string;
  head: string;
  isMain: boolean;
  changes: WorktreeChangeEntry[];
  totals: WorktreeOverviewTotals;
  truncated: boolean;
  totalDetected: number;
  activeAgents: WorktreeOverviewAgent[];
  error?: string;
}

export interface WorktreeOverviewResponse {
  projectPath: string;
  isGitRepo: boolean;
  worktrees: WorktreeOverviewItem[];
  generatedAt: string;
}

export interface TerminalSession {
  id: string;
  agentId: string | null;
  agentName: string | null;
  agentEmail: string | null;
  cliType: CliType;
  executionMode: ExecutionMode;
  swarmRole: SwarmRole;
  functionalRole: FunctionalRole | null;
  worktreeBranch?: string;
  officeId?: string;
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
  functionalRole?: FunctionalRole | null;
  projectPath?: string;
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

export interface WsSetProjectPathMsg {
  type: 'set-project-path';
  projectPath: string;
  officeId?: string;
}

export interface WsInjectMsg {
  type: 'inject';
  sessionId: string;
  text: string;
}

export type ClientMessage = WsCreateMsg | WsInputMsg | WsResizeMsg | WsKillMsg | WsSetRoleMsg | WsSetProjectPathMsg | WsInjectMsg;

export interface WsCreatedMsg { type: 'created'; sessionId: string; requestId?: string; agentId: string | null; cliType: CliType }
export interface WsOutputMsg { type: 'output'; sessionId: string; data: string }
export interface WsExitedMsg { type: 'exited'; sessionId: string; exitCode: number }
export interface WsErrorMsg { type: 'error'; message: string }
export interface WsSwarmUpdateMsg { type: 'swarm:update'; members: SwarmMember[]; leadSessionId: string | null; officeId?: string }
export interface WsSessionSpawnedMsg { type: 'session:spawned'; sessionId: string; agentId: string | null; agentName: string | null; agentEmail: string | null; cliType: CliType; executionMode: ExecutionMode; swarmRole: SwarmRole; functionalRole: FunctionalRole | null; worktreeBranch?: string | null; officeId?: string }
export interface WsSessionRestoreMsg { type: 'session:restore'; sessionId: string; agentId: string | null; agentName: string | null; agentEmail: string | null; cliType: CliType; executionMode: ExecutionMode; swarmRole: SwarmRole; functionalRole: FunctionalRole | null; worktreeBranch?: string | null; scrollback?: string; officeId?: string }
export interface WsShiftProgressMsg { type: 'shift:progress'; officeId: string; slotIndex: number; slotName: string; status: ShiftSlotStatus; sessionId?: string; error?: string }
export interface WsShiftStatusMsg { type: 'shift:status'; shift: ShiftState }

export type NotificationType = 'shift_ended' | 'agent_failed' | 'shift_review' | 'all_tasks_done';

export interface OfficeNotification {
  id: string;
  officeId: string;
  officeName: string;
  type: NotificationType;
  message: string;
  timestamp: string;
  read: boolean;
}

export interface WsOfficeNotificationMsg {
  type: 'office:notification';
  notification: OfficeNotification;
}

export type ServerMessage = WsCreatedMsg | WsOutputMsg | WsExitedMsg | WsErrorMsg | WsSwarmUpdateMsg | WsSessionSpawnedMsg | WsSessionRestoreMsg | WsShiftProgressMsg | WsShiftStatusMsg | WsOfficeNotificationMsg;

// --- Saved session picker types ---

export interface SavedSessionSummary {
  id: string;
  agentId: string | null;
  agentName: string | null;
  agentEmail: string | null;
  projectPath: string | null;
  cliType: CliType;
  executionMode: ExecutionMode;
  permissionMode: PermissionMode;
  swarmRole: SwarmRole;
  functionalRole: FunctionalRole | null;
  createdAt: string;
  lastActivity: string;
}

export interface SavedSessionsResponse {
  hasSavedSessions: boolean;
  savedAt?: string;
  projectPath?: string;
  sessions: SavedSessionSummary[];
}

// --- Structured agent status (from /api/swarm/dashboard) ---

export type CircuitState = 'closed' | 'open';

export interface AgentStructuredStatus {
  agentName: string;
  functionalRole: FunctionalRole | null;
  swarmRole: SwarmRole;
  sessionId: string;
  currentTask?: { id: string; title: string };
  completedTasks: number;
  failedTasks: number;
  lastAction?: string;
  recentFiles: string[];
  idleSeconds: number;
  taskElapsedSeconds?: number;
  circuitState: CircuitState;
  worktreeBranch?: string;
  contextHealth: number;
  compactionCount: number;
  totalOutputKB: number;
}
