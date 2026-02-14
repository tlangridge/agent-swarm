import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

export interface WorktreeInfo {
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

export interface WorktreeChangeTotals {
  changed: number;
  modified: number;
  added: number;
  deleted: number;
  renamed: number;
  untracked: number;
  conflicted: number;
}

export interface WorktreeStatusResult {
  changes: WorktreeChangeEntry[];
  totals: WorktreeChangeTotals;
  truncated: boolean;
  totalDetected: number;
}

export function isGitRepo(dirPath: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd: dirPath, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getWorktreeBaseDir(repoPath: string): string {
  const repoName = path.basename(repoPath);
  const parentDir = path.dirname(repoPath);
  return path.join(parentDir, `${repoName}-worktrees`);
}

export function listWorktrees(repoPath: string): WorktreeInfo[] {
  if (!isGitRepo(repoPath)) return [];

  const output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: repoPath,
    encoding: 'utf-8',
  });

  const worktrees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};
  const pushCurrent = () => {
    if (!current.path) return;
    worktrees.push({
      path: current.path,
      branch: current.branch || '(unknown)',
      head: current.head || '',
      isMain: worktrees.length === 0,
    });
    current = {};
  };

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      current.path = line.slice('worktree '.length);
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      // branch refs/heads/main → main
      current.branch = line.slice('branch '.length).replace('refs/heads/', '');
    } else if (line === 'bare') {
      current.branch = '(bare)';
    } else if (line === 'detached') {
      current.branch = '(detached)';
    } else if (line === '') {
      pushCurrent();
    }
  }
  pushCurrent();

  return worktrees;
}

function validateBranchName(branch: string): void {
  try {
    execFileSync('git', ['check-ref-format', '--branch', branch], { stdio: 'ignore' });
  } catch {
    throw new Error(`Invalid branch name: ${branch}`);
  }
}

export function createWorktree(
  repoPath: string,
  branch: string,
  baseBranch?: string,
): WorktreeInfo {
  validateBranchName(branch);

  const baseDir = getWorktreeBaseDir(repoPath);
  const worktreePath = path.join(baseDir, branch);

  if (existsSync(worktreePath)) {
    throw new Error(`Worktree path already exists: ${worktreePath}`);
  }

  // Check if branch already exists
  let branchExists = false;
  try {
    execFileSync('git', ['rev-parse', '--verify', `refs/heads/${branch}`], {
      cwd: repoPath,
      stdio: 'ignore',
    });
    branchExists = true;
  } catch {
    // branch doesn't exist
  }

  if (branchExists) {
    // Check out existing branch in new worktree
    execFileSync('git', ['worktree', 'add', worktreePath, branch], {
      cwd: repoPath,
      encoding: 'utf-8',
    });
  } else {
    // Create new branch and worktree
    const base = baseBranch || 'HEAD';
    execFileSync('git', ['worktree', 'add', '-b', branch, worktreePath, base], {
      cwd: repoPath,
      encoding: 'utf-8',
    });
  }

  // Get the HEAD of the new worktree
  let head = '';
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: worktreePath,
      encoding: 'utf-8',
    }).trim();
  } catch {
    // ignore
  }

  return { path: worktreePath, branch, head, isMain: false };
}

export function removeWorktree(repoPath: string, branch: string): void {
  validateBranchName(branch);
  const baseDir = getWorktreeBaseDir(repoPath);
  const worktreePath = path.join(baseDir, branch);

  execFileSync('git', ['worktree', 'remove', worktreePath], {
    cwd: repoPath,
    encoding: 'utf-8',
  });
}

function decodeStatusPath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return trimmed;
}

function mapStatus(indexStatus: string, workingStatus: string): WorktreeChangeStatus {
  if (indexStatus === '?' && workingStatus === '?') return '??';
  if (
    indexStatus === 'U'
    || workingStatus === 'U'
    || (indexStatus === 'A' && workingStatus === 'A')
    || (indexStatus === 'D' && workingStatus === 'D')
  ) return 'U';
  if (indexStatus === 'R' || workingStatus === 'R' || indexStatus === 'C' || workingStatus === 'C') return 'R';
  if (indexStatus === 'A' || workingStatus === 'A') return 'A';
  if (indexStatus === 'D' || workingStatus === 'D') return 'D';
  return 'M';
}

export function parsePorcelainStatus(output: string): WorktreeChangeEntry[] {
  const entries: WorktreeChangeEntry[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    if (!line) continue;

    if (line.startsWith('?? ')) {
      entries.push({
        status: '??',
        path: decodeStatusPath(line.slice(3)),
      });
      continue;
    }

    if (line.length < 4 || line[2] !== ' ') continue;

    const indexStatus = line[0];
    const workingStatus = line[1];
    const status = mapStatus(indexStatus, workingStatus);
    const payload = line.slice(3);
    const arrowIndex = payload.indexOf(' -> ');

    if (arrowIndex > 0 && status === 'R') {
      const oldPath = decodeStatusPath(payload.slice(0, arrowIndex));
      const newPath = decodeStatusPath(payload.slice(arrowIndex + 4));
      entries.push({ status: 'R', oldPath, path: newPath });
      continue;
    }

    entries.push({
      status,
      path: decodeStatusPath(payload),
    });
  }

  return entries;
}

export function summarizeChanges(changes: WorktreeChangeEntry[]): WorktreeChangeTotals {
  const totals: WorktreeChangeTotals = {
    changed: changes.length,
    modified: 0,
    added: 0,
    deleted: 0,
    renamed: 0,
    untracked: 0,
    conflicted: 0,
  };

  for (const change of changes) {
    if (change.status === 'M') totals.modified += 1;
    else if (change.status === 'A') totals.added += 1;
    else if (change.status === 'D') totals.deleted += 1;
    else if (change.status === 'R') totals.renamed += 1;
    else if (change.status === '??') totals.untracked += 1;
    else if (change.status === 'U') totals.conflicted += 1;
  }

  return totals;
}

export function normalizeFsPath(inputPath: string): string {
  const resolved = path.resolve(inputPath).replace(/\\/g, '/');
  if (resolved.length > 1 && resolved.endsWith('/')) {
    return resolved.slice(0, -1);
  }
  return resolved;
}

export function getWorktreeStatus(worktreePath: string, fileLimit = 500): WorktreeStatusResult {
  const statusOutput = execFileSync('git', ['status', '--porcelain', '-uall'], {
    cwd: worktreePath,
    encoding: 'utf-8',
  });
  const allChanges = parsePorcelainStatus(statusOutput);
  const priority: Record<WorktreeChangeStatus, number> = {
    U: 0,
    M: 1,
    A: 2,
    D: 3,
    R: 4,
    '??': 5,
  };

  allChanges.sort((a, b) => {
    const byStatus = priority[a.status] - priority[b.status];
    if (byStatus !== 0) return byStatus;
    return a.path.localeCompare(b.path);
  });

  const totalDetected = allChanges.length;
  const truncated = totalDetected > fileLimit;
  const changes = truncated ? allChanges.slice(0, fileLimit) : allChanges;
  const totals = summarizeChanges(allChanges);
  return { changes, totals, truncated, totalDetected };
}
