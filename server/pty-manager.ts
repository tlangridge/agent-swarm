import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import { execSync } from 'child_process';

export type CliType = 'bash' | 'claude' | 'gemini' | 'codex' | 'opencode';

export interface PtySession {
  id: string;
  agentId: string | null;
  agentName: string | null;
  agentEmail: string | null;
  cliType: CliType;
  pty: IPty;
  cols: number;
  rows: number;
  createdAt: Date;
}

export const sessions = new Map<string, PtySession>();

// Resolve full path for CLI binaries using the user's login shell PATH
const resolvedPaths: Partial<Record<CliType, string>> = {};

function resolveCliPath(cliType: CliType): string {
  if (cliType === 'bash') return process.env.SHELL || '/bin/bash';
  if (resolvedPaths[cliType]) return resolvedPaths[cliType]!;

  // Use login shell to resolve the binary path (picks up ~/.zprofile, ~/.zshrc PATH etc.)
  const shell = process.env.SHELL || '/bin/zsh';
  try {
    const fullPath = execSync(`${shell} -ilc "which ${cliType}" 2>/dev/null`, { encoding: 'utf-8' }).trim();
    if (fullPath) {
      resolvedPaths[cliType] = fullPath;
      console.log(`Resolved ${cliType} → ${fullPath}`);
      return fullPath;
    }
  } catch {
    // fall through
  }

  // Fallback: try common known paths
  const knownPaths: Partial<Record<CliType, string[]>> = {
    claude: [`${process.env.HOME}/.local/bin/claude`, '/usr/local/bin/claude'],
    gemini: [`${process.env.HOME}/.nvm/versions/node/v22.21.1/bin/gemini`, '/usr/local/bin/gemini'],
    codex: ['/opt/homebrew/bin/codex', '/usr/local/bin/codex'],
    opencode: ['/usr/local/bin/opencode', '/opt/homebrew/bin/opencode'],
  };

  const candidates = knownPaths[cliType] || [];
  for (const p of candidates) {
    try {
      execSync(`test -x "${p}"`, { stdio: 'ignore' });
      resolvedPaths[cliType] = p;
      console.log(`Resolved ${cliType} → ${p} (fallback)`);
      return p;
    } catch {
      // not found, try next
    }
  }

  // Last resort: return bare name and let spawn fail with a clear error
  console.warn(`Could not resolve path for ${cliType}, using bare command name`);
  return cliType;
}

function getCliArgs(cliType: CliType, agent?: { name: string; email: string } | null): string[] {
  if (cliType === 'claude') {
    const args = ['--dangerously-skip-permissions'];
    if (agent) {
      args.push(
        '--append-system-prompt',
        `Your identity: Name="${agent.name}", Email="${agent.email}". Use this identity when collaborating with other agents or signing up for services.`,
      );
    }
    return args;
  }
  return [];
}

export function spawnSession(
  id: string,
  cliType: CliType,
  cols: number,
  rows: number,
  agent?: { id: string; name: string; email: string } | null,
): PtySession {
  const shell = resolveCliPath(cliType);
  const args = getCliArgs(cliType, agent);

  // Build env with full PATH from login shell
  const env: Record<string, string> = { ...process.env as Record<string, string> };

  // Ensure common bin dirs are in PATH
  const extraPaths = [
    `${process.env.HOME}/.local/bin`,
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  const currentPath = env.PATH || '';
  const missingPaths = extraPaths.filter(p => !currentPath.includes(p));
  if (missingPaths.length > 0) {
    env.PATH = [...missingPaths, currentPath].join(':');
  }

  if (agent) {
    env.AGENT_SWARM_AGENT_ID = agent.id;
    env.AGENT_SWARM_AGENT_NAME = agent.name;
    env.AGENT_SWARM_AGENT_EMAIL = agent.email;
  }

  const ptyProcess = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.env.HOME || '/tmp',
    env,
  });

  const session: PtySession = {
    id,
    agentId: agent?.id ?? null,
    agentName: agent?.name ?? null,
    agentEmail: agent?.email ?? null,
    cliType,
    pty: ptyProcess,
    cols,
    rows,
    createdAt: new Date(),
  };

  sessions.set(id, session);
  return session;
}

export function resizeSession(sessionId: string, cols: number, rows: number): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.pty.resize(cols, rows);
    session.cols = cols;
    session.rows = rows;
  }
}

export function killSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    try { session.pty.kill(); } catch { /* already dead */ }
    try { process.kill(session.pty.pid, 'SIGKILL'); } catch { /* already dead */ }
    sessions.delete(sessionId);
  }
}

export function killAll(): void {
  for (const [, session] of sessions) {
    try { session.pty.kill(); } catch { /* already dead */ }
    try { process.kill(session.pty.pid, 'SIGKILL'); } catch { /* already dead */ }
  }
  sessions.clear();
}

// Validate CLI tools at startup
export function validateCliTools(): void {
  const tools: CliType[] = ['claude', 'gemini', 'codex'];
  for (const tool of tools) {
    const resolved = resolveCliPath(tool);
    if (resolved === tool) {
      console.warn(`⚠ ${tool} not found in PATH — launching ${tool} terminals will fail`);
    }
  }
}
