import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync, copyFileSync, readdirSync } from 'fs';
import path from 'path';
import type { SwarmRole, FunctionalRole } from './services/swarm-registry.js';
import { buildSwarmPrompt } from './services/swarm-prompts.js';
import type { PersonaContext } from './services/swarm-prompts.js';
import type { PipelineStage } from './services/office-store.js';
import { getDefaultSkills } from './services/skill-registry.js';
import { createSkillDir, cleanupSkillDir, cleanupAllSkillDirs } from './services/skill-injector.js';
import { getServerInstanceId } from './services/instance-id.js';

export const PORT = parseInt(process.env.PORT || '3010', 10);
const SERVER_INSTANCE_ID = getServerInstanceId();

export type CliType = 'bash' | 'claude' | 'gemini' | 'codex' | 'opencode';
export type ExecutionMode = 'local' | 'docker';

export interface PtySession {
  id: string;
  officeId: string | null;
  agentId: string | null;
  agentName: string | null;
  agentEmail: string | null;
  projectPath: string | null;
  cliType: CliType;
  executionMode: ExecutionMode;
  permissionMode: PermissionMode;
  containerName: string | null;
  worktreeBranch: string | null;
  skillDirPath: string | null;
  pty: IPty;
  cols: number;
  rows: number;
  scrollback: string;
  createdAt: Date;
  lastDataAt: Date;
  totalOutputBytes: number;
  messageInjectionCount: number;
  compactionCount: number;
}

export const MAX_SCROLLBACK = 100 * 1024; // 100KB per session

export const sessions = new Map<string, PtySession>();

// Resolve full path for CLI binaries using the user's login shell PATH
const resolvedPaths: Partial<Record<CliType, string>> = {};

function resolveCliPath(cliType: CliType): string {
  if (cliType === 'bash') return process.env.SHELL || '/bin/bash';
  if (resolvedPaths[cliType]) return resolvedPaths[cliType]!;

  // Preferred paths — check these FIRST before falling back to `which`
  // This avoids picking up npm-installed versions that trigger self-update loops
  const preferredPaths: Partial<Record<CliType, string[]>> = {
    claude: [`${process.env.HOME}/.local/bin/claude`],
    codex: ['/opt/homebrew/bin/codex', '/usr/local/bin/codex'],
  };
  for (const p of preferredPaths[cliType] || []) {
    try {
      execSync(`test -x "${p}"`, { stdio: 'ignore' });
      resolvedPaths[cliType] = p;
      console.log(`Resolved ${cliType} → ${p} (preferred)`);
      return p;
    } catch {
      // not found, try next
    }
  }

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

export type PermissionMode = 'autonomous' | 'regular';

function tomlStringLiteral(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function getCodexModelForRole(swarmRole: SwarmRole): string {
  const universal = process.env.SWARM_CODEX_MODEL?.trim();
  const lead = process.env.SWARM_CODEX_MODEL_LEAD?.trim();
  const worker = process.env.SWARM_CODEX_MODEL_WORKER?.trim();
  if (swarmRole === 'lead') return lead || universal || 'gpt-5.4';
  return worker || universal || 'gpt-5.3-codex';
}

function getCodexReasoningEffort(): string {
  return process.env.SWARM_CODEX_REASONING_EFFORT?.trim() || 'xhigh';
}

function getAutonomousArgs(cliType: CliType, permissionMode: PermissionMode): string[] {
  if (permissionMode !== 'autonomous') return [];
  switch (cliType) {
    case 'claude':
      return ['--dangerously-skip-permissions'];
    case 'codex':
      return ['--yolo'];
    case 'gemini':
      return ['--yolo'];
    default:
      return [];
  }
}

function getCodexArgs(swarmRole: SwarmRole, permissionMode: PermissionMode): string[] {
  const args = getAutonomousArgs('codex', permissionMode);
  const model = getCodexModelForRole(swarmRole);
  const reasoningEffort = getCodexReasoningEffort();
  if (model) {
    args.push('--model', model);
  }
  if (reasoningEffort) {
    args.push('-c', `model_reasoning_effort=${tomlStringLiteral(reasoningEffort)}`);
  }
  return args;
}

function getCliArgs(
  cliType: CliType,
  agent?: { name: string; email: string } | null,
  permissionMode: PermissionMode = 'autonomous',
  swarmRole: SwarmRole = 'worker',
  sessionId?: string,
  swarmApiUrl?: string,
  projectPath?: string,
  worktreeBranch?: string,
  functionalRole?: FunctionalRole | null,
  pipeline?: PipelineStage[],
  personaCtx?: PersonaContext,
  skillDirPath?: string | null,
): string[] {
  if (cliType === 'claude') {
    const args = getAutonomousArgs(cliType, permissionMode);
    if (agent && sessionId && swarmApiUrl) {
      const prompt = buildSwarmPrompt(swarmRole, agent, sessionId, swarmApiUrl, projectPath, worktreeBranch, functionalRole, pipeline, personaCtx);
      args.push('--append-system-prompt', prompt);
    } else if (agent) {
      args.push(
        '--append-system-prompt',
        `Your identity: Name="${agent.name}", Email="${agent.email}". Use this identity when collaborating with other agents or signing up for services.`,
      );
    }
    if (skillDirPath) {
      args.push('--add-dir', skillDirPath);
    }
    return args;
  }
  if (cliType === 'codex') {
    return getCodexArgs(swarmRole, permissionMode);
  }
  if (cliType === 'gemini') {
    return getAutonomousArgs(cliType, permissionMode);
  }
  return [];
}

export function spawnSession(
  id: string,
  cliType: CliType,
  cols: number,
  rows: number,
  agent?: { id: string; name: string; email: string } | null,
  executionMode: ExecutionMode = 'local',
  permissionMode: PermissionMode = 'autonomous',
  swarmRole: SwarmRole = 'worker',
  projectPath?: string,
  functionalRole?: FunctionalRole | null,
  pipeline?: PipelineStage[],
  personaCtx?: PersonaContext,
  worktreeBranch?: string,
  officeId?: string | null,
  skills?: string[],
  resolvedKeys?: Record<string, string>,
): PtySession {
  if (executionMode === 'docker') {
    return spawnDockerSession(id, cliType, cols, rows, agent, permissionMode, swarmRole, projectPath, functionalRole, pipeline, personaCtx, officeId, skills, resolvedKeys);
  }
  const effectiveProjectPath = projectPath || process.env.HOME || '/tmp';

  // Resolve and create skill directory for Claude agents
  let skillDirPath: string | null = null;
  if (cliType === 'claude') {
    const defaultSkills = getDefaultSkills(swarmRole, functionalRole);
    const allSkills = [...new Set([...defaultSkills, ...(skills || [])])];
    skillDirPath = createSkillDir(id, allSkills);
  }

  const swarmApiUrl = `http://localhost:${PORT}`;
  const shell = resolveCliPath(cliType);
  const args = getCliArgs(cliType, agent, permissionMode, swarmRole, id, swarmApiUrl, effectiveProjectPath, worktreeBranch, functionalRole, pipeline, personaCtx, skillDirPath);

  // Build env with full PATH from login shell
  const env: Record<string, string> = { ...process.env as Record<string, string>, ...resolvedKeys };
  delete env.CLAUDECODE; // Allow Claude Code to launch from within a Claude Code session

  // Add swarm CLI and common bin dirs to PATH
  const cliDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli');
  const extraPaths = [
    cliDir,
    `${process.env.HOME}/.local/bin`,
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  const currentPath = env.PATH || '';
  const missingPaths = extraPaths.filter(p => !currentPath.includes(p));
  if (missingPaths.length > 0) {
    env.PATH = [...missingPaths, currentPath].join(':');
  }

  // Swarm env vars
  env.AGENT_SWARM_SESSION_ID = id;
  env.SWARM_API_URL = swarmApiUrl;
  env.SWARM_INSTANCE_ID = SERVER_INSTANCE_ID;
  env.AGENT_SWARM_ROLE = swarmRole;

  if (agent) {
    env.AGENT_SWARM_AGENT_ID = agent.id;
    env.AGENT_SWARM_AGENT_NAME = agent.name;
    env.AGENT_SWARM_AGENT_EMAIL = agent.email;
  }

  // Suppress Codex auto-update on startup
  // CODEX_MANAGED_BY_NPM tricks Codex into skipping `brew upgrade --cask codex`
  // which otherwise runs, prints "Please restart Codex", and exits (code 0)
  if (cliType === 'codex') {
    env.CODEX_MANAGED_BY_NPM = '1';
    env.HOMEBREW_NO_AUTO_UPDATE = '1';
    env.npm_config_prefer_offline = '1';
    env.NO_UPDATE_NOTIFIER = '1';
  }

  const ptyProcess = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: effectiveProjectPath,
    env,
  });

  const session: PtySession = {
    id,
    officeId: officeId ?? null,
    agentId: agent?.id ?? null,
    agentName: agent?.name ?? null,
    agentEmail: agent?.email ?? null,
    projectPath: effectiveProjectPath,
    cliType,
    executionMode: 'local',
    permissionMode,
    containerName: null,
    worktreeBranch: worktreeBranch ?? null,
    skillDirPath,
    pty: ptyProcess,
    cols,
    rows,
    scrollback: '',
    createdAt: new Date(),
    lastDataAt: new Date(),
    totalOutputBytes: 0,
    messageInjectionCount: 0,
    compactionCount: 0,
  };

  sessions.set(id, session);
  return session;
}

function getDockerCliCommand(
  cliType: CliType,
  permissionMode: PermissionMode = 'autonomous',
  swarmRole: SwarmRole = 'worker',
): { cmd: string; args: string[] } {
  switch (cliType) {
    case 'claude': return { cmd: 'claude', args: getAutonomousArgs(cliType, permissionMode) };
    case 'gemini': return { cmd: 'gemini', args: [] };
    case 'codex': return { cmd: 'codex', args: getCodexArgs(swarmRole, permissionMode) };
    case 'opencode': return { cmd: 'opencode', args: [] };
    case 'bash': return { cmd: '/bin/bash', args: [] };
  }
}

// Base directory for persistent Docker volumes
const DOCKER_DATA_DIR = path.join(process.cwd(), 'data', 'docker');

function seedCredentials(configDir: string): void {
  const claudeDir = path.join(configDir, 'claude');
  const credFile = path.join(claudeDir, '.credentials.json');

  // Already has credentials — nothing to do
  if (existsSync(credFile)) return;

  // Scan other agents for an existing .credentials.json
  try {
    const entries = readdirSync(DOCKER_DATA_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(DOCKER_DATA_DIR, entry.name, 'config', 'claude', '.credentials.json');
      if (existsSync(candidate)) {
        mkdirSync(claudeDir, { recursive: true });
        copyFileSync(candidate, credFile);
        console.log(`Seeded Claude credentials for ${path.basename(configDir)} from ${entry.name}`);
        return;
      }
    }
  } catch (err) {
    console.warn('seedCredentials: failed to seed credentials:', err);
  }
}

function ensureDockerVolumeDirs(agentId: string | null): { configDir: string; workspaceDir: string } {
  const key = agentId || '_anonymous';
  const configDir = path.join(DOCKER_DATA_DIR, key, 'config');
  const workspaceDir = path.join(DOCKER_DATA_DIR, key, 'workspace');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });
  return { configDir, workspaceDir };
}

function spawnDockerSession(
  id: string,
  cliType: CliType,
  cols: number,
  rows: number,
  agent?: { id: string; name: string; email: string } | null,
  permissionMode: PermissionMode = 'autonomous',
  swarmRole: SwarmRole = 'worker',
  projectPath?: string,
  functionalRole?: FunctionalRole | null,
  pipeline?: PipelineStage[],
  personaCtx?: PersonaContext,
  officeId?: string | null,
  skills?: string[],
  resolvedKeys?: Record<string, string>,
): PtySession {
  const containerName = `agent-swarm-${id.slice(0, 8)}`;
  const { cmd, args: cliArgs } = getDockerCliCommand(cliType, permissionMode, swarmRole);
  const { configDir, workspaceDir } = ensureDockerVolumeDirs(agent?.id ?? null);
  const effectiveProjectPath = projectPath || workspaceDir;

  // Seed Claude credentials from an existing authenticated agent
  if (cliType === 'claude') {
    seedCredentials(configDir);
  }

  const swarmApiUrl = `http://host.docker.internal:${PORT}`;

  const dockerArgs = [
    'run', '-it', '--rm',
    '--name', containerName,
    '--memory=1g', '--cpus=1',
    // Persistent volumes — config survives across sessions
    '-v', `${configDir}/claude:/home/agent/.claude`,
    '-v', `${configDir}/gemini:/home/agent/.gemini`,
    '-v', `${configDir}/codex:/home/agent/.codex`,
    '-v', `${effectiveProjectPath}:/home/agent/workspace`,
  ];

  // On Linux, host.docker.internal isn't provided by default
  if (process.platform === 'linux') {
    dockerArgs.push('--add-host=host.docker.internal:host-gateway');
  }

  // Pass API keys as env vars (resolved keys take priority over process.env)
  const envKeys = [
    'ANTHROPIC_API_KEY',
    'GOOGLE_API_KEY',
    'GEMINI_API_KEY',
    'OPENAI_API_KEY',
    'AGENTMAIL_API_KEY',
  ];
  for (const key of envKeys) {
    const value = resolvedKeys?.[key] || process.env[key];
    if (value) {
      dockerArgs.push('-e', `${key}=${value}`);
    }
  }

  // Swarm env vars
  dockerArgs.push('-e', `AGENT_SWARM_SESSION_ID=${id}`);
  dockerArgs.push('-e', `SWARM_API_URL=${swarmApiUrl}`);
  dockerArgs.push('-e', `SWARM_INSTANCE_ID=${SERVER_INSTANCE_ID}`);
  dockerArgs.push('-e', `AGENT_SWARM_ROLE=${swarmRole}`);

  // Agent identity env vars
  if (agent) {
    dockerArgs.push('-e', `AGENT_SWARM_AGENT_ID=${agent.id}`);
    dockerArgs.push('-e', `AGENT_SWARM_AGENT_NAME=${agent.name}`);
    dockerArgs.push('-e', `AGENT_SWARM_AGENT_EMAIL=${agent.email}`);
  }

  // Suppress Codex auto-update on startup
  if (cliType === 'codex') {
    dockerArgs.push('-e', 'CODEX_MANAGED_BY_NPM=1');
    dockerArgs.push('-e', 'HOMEBREW_NO_AUTO_UPDATE=1');
    dockerArgs.push('-e', 'npm_config_prefer_offline=1');
    dockerArgs.push('-e', 'NO_UPDATE_NOTIFIER=1');
  }

  // Resolve and create skill directory for Claude agents (use hard copy for Docker)
  let skillDirPath: string | null = null;
  if (cliType === 'claude') {
    const defaultSkills = getDefaultSkills(swarmRole, functionalRole);
    const allSkills = [...new Set([...defaultSkills, ...(skills || [])])];
    skillDirPath = createSkillDir(id, allSkills, true); // useHardCopy for Docker
  }

  // Add swarm prompt to Claude's system prompt inside container
  if (cliType === 'claude' && agent) {
    const prompt = buildSwarmPrompt(swarmRole, agent, id, swarmApiUrl, undefined, undefined, functionalRole, pipeline, personaCtx);
    cliArgs.push('--append-system-prompt', prompt);
  }

  // Mount skill dir as read-only volume for Docker
  if (skillDirPath) {
    dockerArgs.push('-v', `${skillDirPath}:/home/agent/.swarm-skills:ro`);
    cliArgs.push('--add-dir', '/home/agent/.swarm-skills');
  }

  dockerArgs.push('agent-swarm-sandbox:latest', cmd, ...cliArgs);

  const ptyProcess = pty.spawn('docker', dockerArgs, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: '/tmp',
    env: process.env as Record<string, string>,
  });

  const session: PtySession = {
    id,
    officeId: officeId ?? null,
    agentId: agent?.id ?? null,
    agentName: agent?.name ?? null,
    agentEmail: agent?.email ?? null,
    projectPath: effectiveProjectPath,
    cliType,
    executionMode: 'docker',
    permissionMode,
    containerName,
    worktreeBranch: null,
    skillDirPath,
    pty: ptyProcess,
    cols,
    rows,
    scrollback: '',
    createdAt: new Date(),
    lastDataAt: new Date(),
    totalOutputBytes: 0,
    messageInjectionCount: 0,
    compactionCount: 0,
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
    // Force-remove Docker container as a safety net
    if (session.containerName) {
      try { execSync(`docker rm -f ${session.containerName}`, { stdio: 'ignore', timeout: 5000 }); } catch { /* already gone */ }
    }
    cleanupSkillDir(sessionId);
    sessions.delete(sessionId);
  }
}

export function killAll(): void {
  for (const [, session] of sessions) {
    try { session.pty.kill(); } catch { /* already dead */ }
    try { process.kill(session.pty.pid, 'SIGKILL'); } catch { /* already dead */ }
    if (session.containerName) {
      try { execSync(`docker rm -f ${session.containerName}`, { stdio: 'ignore', timeout: 5000 }); } catch { /* already gone */ }
    }
  }
  sessions.clear();
  cleanupAllSkillDirs();
}

export function getSessionByAgentName(name: string, officeId?: string): PtySession | undefined {
  const lower = name.toLowerCase();
  for (const session of sessions.values()) {
    if (officeId !== undefined && session.officeId !== officeId) continue;
    if (session.agentName?.toLowerCase() === lower) return session;
  }
  return undefined;
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
