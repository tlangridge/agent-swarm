import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { spawnSession, sessions, MAX_SCROLLBACK } from '../pty-manager.js';
import type { CliType, ExecutionMode, PermissionMode } from '../pty-manager.js';
import { addMember, getMembers } from './swarm-registry.js';
import type { SwarmRole, FunctionalRole } from './swarm-registry.js';
import { setProjectPath, getProjectPath } from '../routes/project.js';
import { injectMessage, registerSession } from './pty-writer.js';

interface PersistedSession {
  id: string;
  agentId: string | null;
  agentName: string | null;
  agentEmail: string | null;
  projectPath: string | null;
  cliType: CliType;
  executionMode: ExecutionMode;
  permissionMode: PermissionMode;
  cols: number;
  rows: number;
  scrollback: string;
  createdAt: string;
  swarmRole: SwarmRole;
  functionalRole: FunctionalRole | null;
  joinedAt: string;
}

interface PersistedState {
  version: 1;
  savedAt: string;
  projectPath: string;
  sessions: PersistedSession[];
}

const STATE_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(STATE_DIR, 'session-state.json');
const MEMORY_ROOT = process.env.AGENT_SWARM_MEMORY_DIR
  || path.join(process.env.HOME || process.cwd(), '.agent-swarm', 'memory');

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function isCliType(value: unknown): value is CliType {
  return value === 'bash' || value === 'claude' || value === 'gemini' || value === 'codex' || value === 'opencode';
}

function isExecutionMode(value: unknown): value is ExecutionMode {
  return value === 'local' || value === 'docker';
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'autonomous' || value === 'regular';
}

function isSwarmRole(value: unknown): value is SwarmRole {
  return value === 'lead' || value === 'worker';
}

function stripAnsi(input: string): string {
  return input.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '');
}

function sanitizeFilePart(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'session';
}

function getProjectMemoryDir(projectPath: string): string {
  const keySeed = (projectPath || process.cwd()).trim();
  const projectKey = createHash('sha1').update(keySeed).digest('hex').slice(0, 12);
  return path.join(MEMORY_ROOT, projectKey);
}

function getMemoryPath(session: PersistedSession, globalProjectPath: string): string {
  const projectDir = getProjectMemoryDir(session.projectPath || globalProjectPath);
  const label = sanitizeFilePart(session.agentName || session.agentId || session.id);
  const shortId = sanitizeFilePart(session.id.slice(0, 12));
  return path.join(projectDir, `${label}-${shortId}.md`);
}

function buildMemoryDocument(session: PersistedSession, generatedAt: string): string {
  const transcript = stripAnsi(session.scrollback || '').replace(/\r/g, '').trim().slice(-24000);
  const lines = [
    '# Agent Memory Snapshot',
    '',
    `- Generated: ${generatedAt}`,
    `- Session: ${session.id}`,
    `- Agent: ${session.agentName || 'unknown'}${session.agentEmail ? ` <${session.agentEmail}>` : ''}`,
    `- Role: ${session.swarmRole}${session.functionalRole ? ` (${session.functionalRole})` : ''}`,
    `- CLI: ${session.cliType}`,
    `- Execution Mode: ${session.executionMode}`,
    `- Working Directory: ${session.projectPath || 'unknown'}`,
    '',
    '## Recent Transcript',
    transcript || '(no transcript captured yet)',
    '',
  ];
  return lines.join('\n');
}

function writeMemoryCheckpoints(snapshot: PersistedState): void {
  for (const session of snapshot.sessions) {
    const memoryPath = getMemoryPath(session, snapshot.projectPath);
    mkdirSync(path.dirname(memoryPath), { recursive: true });
    writeFileSync(memoryPath, buildMemoryDocument(session, snapshot.savedAt), 'utf-8');
  }
}

function readMemoryCheckpoint(session: PersistedSession, globalProjectPath: string): string {
  const memoryPath = getMemoryPath(session, globalProjectPath);
  if (!existsSync(memoryPath)) return '';
  try {
    const raw = readFileSync(memoryPath, 'utf-8');
    return raw.trim().slice(-12000);
  } catch {
    return '';
  }
}

function buildRecoveryPrompt(session: PersistedSession, memoryCheckpoint: string): string {
  const cleaned = stripAnsi(session.scrollback || '').replace(/\r/g, '');
  const contextTail = cleaned.slice(-12000).trim();
  const roleLabel = session.swarmRole === 'lead' ? 'lead' : 'worker';
  const projectLine = session.projectPath ? `Working directory before restart: ${session.projectPath}` : 'Working directory before restart: unknown';
  const header = [
    '[SYSTEM] The Agent Swarm server restarted and restored your session.',
    `Your role remains: ${roleLabel}.`,
    projectLine,
    'Rebuild your working memory from the recent transcript below, then continue where you left off.',
  ].join('\n');

  if (!memoryCheckpoint && !contextTail) {
    return `${header}\n\nNo prior transcript was captured. Start by restating your current plan and next action.`;
  }

  const sections: string[] = [header];
  if (memoryCheckpoint) {
    sections.push(`Recovered memory checkpoint:\n${memoryCheckpoint}`);
  }
  if (contextTail) {
    sections.push(`Recent transcript (most recent last):\n${contextTail}`);
  }
  return sections.join('\n\n');
}

function serializeState(): PersistedState {
  const membersBySessionId = new Map(getMembers().map(member => [member.sessionId, member]));
  const persistedSessions: PersistedSession[] = [];

  for (const session of sessions.values()) {
    const member = membersBySessionId.get(session.id);
    persistedSessions.push({
      id: session.id,
      agentId: session.agentId,
      agentName: session.agentName,
      agentEmail: session.agentEmail,
      projectPath: session.projectPath,
      cliType: session.cliType,
      executionMode: session.executionMode,
      permissionMode: session.permissionMode,
      cols: session.cols,
      rows: session.rows,
      scrollback: session.scrollback.slice(-MAX_SCROLLBACK),
      createdAt: session.createdAt.toISOString(),
      swarmRole: member?.role ?? 'worker',
      functionalRole: member?.functionalRole ?? null,
      joinedAt: member?.joinedAt ?? new Date().toISOString(),
    });
  }

  return {
    version: 1,
    savedAt: new Date().toISOString(),
    projectPath: getProjectPath(),
    sessions: persistedSessions,
  };
}

function parseState(raw: string): PersistedState | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) return null;
    if (typeof parsed.savedAt !== 'string') return null;
    if (typeof parsed.projectPath !== 'string') return null;

    const sessionsList: PersistedSession[] = [];
    for (const item of parsed.sessions) {
      if (!item || typeof item !== 'object') continue;
      const candidate = item as Partial<PersistedSession>;
      if (
        typeof candidate.id !== 'string' ||
        (candidate.agentId !== null && typeof candidate.agentId !== 'string') ||
        (candidate.agentName !== null && typeof candidate.agentName !== 'string') ||
        (candidate.agentEmail !== null && typeof candidate.agentEmail !== 'string') ||
        (candidate.projectPath !== null && typeof candidate.projectPath !== 'string') ||
        !isCliType(candidate.cliType) ||
        !isExecutionMode(candidate.executionMode) ||
        !isPermissionMode(candidate.permissionMode) ||
        typeof candidate.cols !== 'number' ||
        typeof candidate.rows !== 'number' ||
        typeof candidate.scrollback !== 'string' ||
        typeof candidate.createdAt !== 'string' ||
        !isSwarmRole(candidate.swarmRole) ||
        typeof candidate.joinedAt !== 'string'
      ) {
        continue;
      }
      sessionsList.push({
        id: candidate.id,
        agentId: candidate.agentId,
        agentName: candidate.agentName,
        agentEmail: candidate.agentEmail,
        projectPath: candidate.projectPath,
        cliType: candidate.cliType,
        executionMode: candidate.executionMode,
        permissionMode: candidate.permissionMode,
        cols: candidate.cols,
        rows: candidate.rows,
        scrollback: candidate.scrollback,
        createdAt: candidate.createdAt,
        swarmRole: candidate.swarmRole,
        functionalRole: (candidate as any).functionalRole ?? null,
        joinedAt: candidate.joinedAt,
      });
    }

    return {
      version: 1,
      savedAt: parsed.savedAt,
      projectPath: parsed.projectPath,
      sessions: sessionsList,
    };
  } catch {
    return null;
  }
}

export function persistStateNow(): void {
  const snapshot = serializeState();
  writeMemoryCheckpoints(snapshot);
  mkdirSync(STATE_DIR, { recursive: true });
  const tempPath = `${STATE_FILE}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8');
  renameSync(tempPath, STATE_FILE);
}

export function schedulePersistState(delayMs = 500): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      persistStateNow();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.error(`Failed to persist session state: ${message}`);
    }
  }, delayMs);
}

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

export interface SavedStateInfo {
  savedAt: string;
  projectPath: string;
  sessions: SavedSessionSummary[];
}

function extractLastActivity(scrollback: string, maxLen = 500): string {
  const cleaned = stripAnsi(scrollback || '').replace(/\r/g, '').trim();
  if (!cleaned) return '';
  const tail = cleaned.slice(-maxLen);
  const lineStart = tail.indexOf('\n');
  return lineStart >= 0 ? tail.slice(lineStart + 1).trim() : tail.trim();
}

export function getSavedSessionSummaries(): SavedStateInfo | null {
  if (!existsSync(STATE_FILE)) return null;
  const parsed = parseState(readFileSync(STATE_FILE, 'utf-8'));
  if (!parsed || parsed.sessions.length === 0) return null;

  return {
    savedAt: parsed.savedAt,
    projectPath: parsed.projectPath,
    sessions: parsed.sessions.map(s => ({
      id: s.id,
      agentId: s.agentId,
      agentName: s.agentName,
      agentEmail: s.agentEmail,
      projectPath: s.projectPath,
      cliType: s.cliType,
      executionMode: s.executionMode,
      permissionMode: s.permissionMode,
      swarmRole: s.swarmRole,
      functionalRole: s.functionalRole,
      createdAt: s.createdAt,
      lastActivity: extractLastActivity(s.scrollback),
    })),
  };
}

export function clearSavedState(): void {
  if (existsSync(STATE_FILE)) {
    const emptyState: PersistedState = {
      version: 1,
      savedAt: new Date().toISOString(),
      projectPath: getProjectPath(),
      sessions: [],
    };
    writeFileSync(STATE_FILE, `${JSON.stringify(emptyState, null, 2)}\n`, 'utf-8');
  }
}

export function restorePersistedState(filterSessionIds?: string[]): { restored: number; failed: number } {
  if (!existsSync(STATE_FILE)) {
    return { restored: 0, failed: 0 };
  }

  const parsed = parseState(readFileSync(STATE_FILE, 'utf-8'));
  if (!parsed) {
    console.warn('Session state file is invalid; skipping restore.');
    return { restored: 0, failed: 0 };
  }

  setProjectPath(parsed.projectPath);

  const sessionsToRestore = filterSessionIds
    ? parsed.sessions.filter(s => filterSessionIds.includes(s.id))
    : parsed.sessions;

  let restored = 0;
  let failed = 0;
  let hasLead = false;

  for (const snapshot of sessionsToRestore) {
    if (sessions.has(snapshot.id)) continue;
    try {
      const agent = snapshot.agentId ? {
        id: snapshot.agentId,
        name: snapshot.agentName || 'Unknown',
        email: snapshot.agentEmail || '',
      } : null;
      const cols = Number.isFinite(snapshot.cols) ? Math.max(20, snapshot.cols) : 80;
      const rows = Number.isFinite(snapshot.rows) ? Math.max(10, snapshot.rows) : 24;
      const role: SwarmRole = snapshot.swarmRole === 'lead' && !hasLead ? 'lead' : 'worker';
      if (role === 'lead') hasLead = true;

      const session = spawnSession(
        snapshot.id,
        snapshot.cliType,
        cols,
        rows,
        agent,
        snapshot.executionMode,
        snapshot.permissionMode,
        role,
        snapshot.projectPath || undefined,
        snapshot.functionalRole,
      );

      session.scrollback = (snapshot.scrollback || '').slice(-MAX_SCROLLBACK);
      const restoredCreatedAt = new Date(snapshot.createdAt);
      if (!Number.isNaN(restoredCreatedAt.valueOf())) {
        session.createdAt = restoredCreatedAt;
      }

      addMember({
        sessionId: snapshot.id,
        agentId: snapshot.agentId,
        agentName: snapshot.agentName,
        agentEmail: snapshot.agentEmail,
        cliType: snapshot.cliType,
        executionMode: snapshot.executionMode,
        role,
        functionalRole: snapshot.functionalRole,
        joinedAt: snapshot.joinedAt || new Date().toISOString(),
      });

      registerSession(snapshot.id, session.pty);
      if (snapshot.cliType !== 'bash') {
        const memoryCheckpoint = readMemoryCheckpoint(snapshot, parsed.projectPath);
        const recoveryPrompt = buildRecoveryPrompt(snapshot, memoryCheckpoint);
        setTimeout(() => {
          injectMessage(snapshot.id, recoveryPrompt).catch(() => {});
        }, 800);
      }

      restored++;
    } catch (err: unknown) {
      failed++;
      const message = err instanceof Error ? err.message : 'unknown error';
      console.error(`Failed to restore session ${snapshot.id}: ${message}`);
    }
  }

  schedulePersistState();
  return { restored, failed };
}
