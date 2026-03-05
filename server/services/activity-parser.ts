import { sessions } from '../pty-manager.js';
import { getMembers, getMembersByOffice } from './swarm-registry.js';
import type { SwarmRole, FunctionalRole, CircuitState } from './swarm-registry.js';
import { listTasks } from './task-board.js';
import { getActiveShift } from './shift-manager.js';
import { computeContextHealth } from './context-monitor.js';
import { getCostRecord } from './cost-tracker.js';

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
  totalCost: number;
  budgetCents: number | null;
  budgetPercent: number | null;
}

// Patterns to detect meaningful actions from cleaned terminal output
const ACTION_PATTERNS: Array<{ pattern: RegExp; label: (match: RegExpMatchArray) => string }> = [
  { pattern: /(?:Edit|Write|Update|Create|Modify)(?:ing|ed)?\s+['"`]?(\S+)['"`]?/i, label: m => `Editing ${m[1]}` },
  { pattern: /(?:Running|Ran|Executing)\s+['"`]?(.+?)['"`]?\s*$/i, label: m => `Running ${m[1]}` },
  { pattern: /\$\s*(npm|yarn|pnpm|bun|make|cargo|go|python|pytest|jest|vitest)\s+(.+)/i, label: m => `Running ${m[1]} ${m[2].slice(0, 40)}` },
  { pattern: /(?:git)\s+(commit|push|pull|checkout|merge|rebase|stash|diff)\b/i, label: m => `Git ${m[1]}` },
  { pattern: /(?:PASS|FAIL|Tests?:?\s+\d+)/i, label: () => 'Reviewing test results' },
  { pattern: /(?:reading|analyzing|reviewing|searching)\s+(.+)/i, label: m => `Reviewing ${m[1].slice(0, 40)}` },
  { pattern: /swarm\s+task\s+(pick|done|fail|create|update)/i, label: m => `Swarm task ${m[1]}` },
  { pattern: /swarm\s+msg\s+(\S+)/i, label: m => `Messaging ${m[1]}` },
];

const FILE_PATTERN = /(?:^|\s|['"`])([\w./@+-]+\.(?:ts|tsx|js|jsx|css|html|json|md|py|rs|go|java|yaml|yml|toml|sql|sh|vue|svelte))\b/;

function stripAnsi(input: string): string {
  return input.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '');
}

export function parseLastAction(scrollback: string): string | undefined {
  const cleaned = stripAnsi(scrollback).replace(/\r/g, '');
  const lines = cleaned.split('\n').filter(l => l.trim()).slice(-50);

  for (let i = lines.length - 1; i >= 0; i--) {
    for (const { pattern, label } of ACTION_PATTERNS) {
      const match = lines[i].match(pattern);
      if (match) return label(match);
    }
  }
  return undefined;
}

export function extractRecentFiles(scrollback: string, maxFiles = 5): string[] {
  const cleaned = stripAnsi(scrollback).replace(/\r/g, '');
  const lines = cleaned.split('\n').slice(-100);
  const files = new Set<string>();

  for (const line of lines) {
    const match = line.match(FILE_PATTERN);
    if (match && !match[1].startsWith('node_modules/') && !match[1].startsWith('.git/')) {
      files.add(match[1]);
    }
  }

  return Array.from(files).slice(-maxFiles);
}

export async function getStructuredStatus(scopeOfficeId?: string): Promise<AgentStructuredStatus[]> {
  const members = scopeOfficeId ? getMembersByOffice(scopeOfficeId) : getMembers();
  const officeId = scopeOfficeId || getActiveShift()?.officeId;
  const shift = officeId ? getActiveShift(officeId) : getActiveShift();
  const allTasks = await listTasks(officeId ? { officeId } : undefined);
  const result: AgentStructuredStatus[] = [];

  for (const member of members) {
    const session = sessions.get(member.sessionId);
    const idleSeconds = session
      ? Math.round((Date.now() - session.lastDataAt.getTime()) / 1000)
      : -1;

    const agentTasks = allTasks.filter(t => t.assignedTo === member.agentName);
    const inProgress = agentTasks.find(t => t.status === 'in-progress');
    const completedCount = agentTasks.filter(t => t.status === 'done').length;
    const failedCount = agentTasks.filter(t => t.status === 'blocked').length;

    let lastAction: string | undefined;
    let recentFiles: string[] = [];

    if (session) {
      lastAction = parseLastAction(session.scrollback);
      recentFiles = extractRecentFiles(session.scrollback);
    }

    if (!lastAction && idleSeconds > 120) {
      lastAction = 'Idle';
    }

    const taskElapsedSeconds = inProgress?.updatedAt
      ? Math.round((Date.now() - new Date(inProgress.updatedAt).getTime()) / 1000)
      : undefined;

    // Find worktree branch from shift slot state
    const slotState = shift?.slots.find(s => s.sessionId === member.sessionId);

    // Cost tracking data
    const costRecord = getCostRecord(member.sessionId);
    const totalCost = costRecord?.totalCost ?? 0;
    const budgetCents = costRecord?.budgetCents ?? null;
    const budgetPercent = budgetCents
      ? Math.round((totalCost * 100) / (budgetCents / 100) * 100) / 100
      : null;

    result.push({
      agentName: member.agentName || 'Unknown',
      functionalRole: member.functionalRole,
      swarmRole: member.role,
      sessionId: member.sessionId,
      currentTask: inProgress ? { id: inProgress.id, title: inProgress.title } : undefined,
      completedTasks: completedCount,
      failedTasks: failedCount,
      lastAction,
      recentFiles,
      idleSeconds,
      taskElapsedSeconds,
      circuitState: member.circuitState,
      worktreeBranch: slotState?.worktreeBranch || session?.worktreeBranch || undefined,
      contextHealth: computeContextHealth(member.sessionId),
      compactionCount: session?.compactionCount ?? 0,
      totalOutputKB: Math.round((session?.totalOutputBytes ?? 0) / 1024),
      totalCost,
      budgetCents,
      budgetPercent,
    });
  }

  return result;
}
