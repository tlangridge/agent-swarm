import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { nanoid } from 'nanoid';
import { getDataPath } from './data-root.js';

const TASKS_DIR = getDataPath('tasks');

export interface VerificationRun {
  command: string;
  exitCode: number;
  outputSnippet: string;
  ranAt: string;
}

export interface CompletionReport {
  agent: string;
  branch?: string;
  diffStat?: { filesChanged: number; insertions: number; deletions: number; files: string[] };
  diffPatch?: string;
  verificationRuns?: VerificationRun[];
  generatedAt: string;
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
  completionReport?: CompletionReport;
  checkoutSessionId?: string;
  checkoutAgentName?: string;
  checkedOutAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskFilters {
  stage?: string;
  assignedTo?: string;
  status?: string;
  priority?: string;
  officeId?: string;
}

function normalizeTaskStatus(status: TaskItem['status'] | string | undefined): TaskItem['status'] | undefined {
  if (!status) return undefined;
  if (status === 'archived') return 'done';
  if (status === 'in_progress') return 'in-progress';
  if (status === 'open' || status === 'in-progress' || status === 'blocked' || status === 'done') {
    return status;
  }
  return undefined;
}

function normalizeTask(task: TaskItem): TaskItem {
  return {
    ...task,
    stage: typeof task.stage === 'string' ? task.stage.trim() : task.stage,
    status: normalizeTaskStatus(task.status) ?? 'open',
  };
}

async function getBlockingDependencyIds(task: TaskItem, taskCache?: Map<string, TaskItem>): Promise<string[]> {
  if (!task.dependsOn || task.dependsOn.length === 0) {
    return [];
  }

  const blocking: string[] = [];
  for (const depId of task.dependsOn) {
    const dep = taskCache?.get(depId) ?? await getTask(depId);
    if (!dep || dep.status !== 'done') {
      blocking.push(depId);
    }
  }
  return blocking;
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(TASKS_DIR, { recursive: true });
}

function taskFilePath(taskId: string): string {
  return path.join(TASKS_DIR, `${taskId}.json`);
}

const taskWriteLocks = new Map<string, Promise<unknown>>();

async function withTaskWriteLock<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
  const prev = taskWriteLocks.get(taskId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(operation);
  taskWriteLocks.set(taskId, next);

  try {
    return await next;
  } finally {
    if (taskWriteLocks.get(taskId) === next) {
      taskWriteLocks.delete(taskId);
    }
  }
}

async function writeTask(task: TaskItem): Promise<void> {
  await ensureDir();
  const filePath = taskFilePath(task.id);
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(task, null, 2));
  await fs.rename(tmpPath, filePath);
}

export async function listTasks(filters?: TaskFilters): Promise<TaskItem[]> {
  await ensureDir();
  const files = await fs.readdir(TASKS_DIR);
  let result: TaskItem[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const data = await fs.readFile(path.join(TASKS_DIR, f), 'utf-8');
      const task = normalizeTask(JSON.parse(data));
      result.push(task);
    } catch (err) {
      console.error(`task-board: failed to parse ${f}, skipping:`, err);
    }
  }
  if (filters?.stage) {
    result = result.filter(t => t.stage === filters.stage);
  }
  if (filters?.assignedTo) {
    result = result.filter(t => t.assignedTo === filters.assignedTo);
  }
  if (filters?.status) {
    result = result.filter(t => t.status === filters.status);
  }
  if (filters?.priority) {
    result = result.filter(t => t.priority === filters.priority);
  }
  if (filters?.officeId) {
    result = result.filter(t => t.officeId === filters.officeId);
  }
  return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getTask(id: string): Promise<TaskItem | undefined> {
  try {
    const data = await fs.readFile(taskFilePath(id), 'utf-8');
    return normalizeTask(JSON.parse(data));
  } catch {
    return undefined;
  }
}

export async function createTask(data: {
  title: string;
  description?: string;
  stage: string;
  assignedTo?: string;
  createdBy: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  context?: string;
  tags?: string[];
  parentTask?: string;
  dependsOn?: string[];
  shiftId?: string;
  officeId?: string;
  branch?: string;
  prNumber?: number;
  prUrl?: string;
  issueNumber?: number;
  issueUrl?: string;
}): Promise<TaskItem> {
  await ensureDir();
  const now = new Date().toISOString();
  const task: TaskItem = {
    id: nanoid(8),
    title: data.title,
    description: data.description,
    stage: data.stage,
    assignedTo: data.assignedTo,
    createdBy: data.createdBy,
    status: 'open',
    priority: data.priority,
    context: data.context,
    tags: data.tags,
    parentTask: data.parentTask,
    dependsOn: data.dependsOn,
    shiftId: data.shiftId,
    officeId: data.officeId,
    branch: data.branch,
    prNumber: data.prNumber,
    prUrl: data.prUrl,
    issueNumber: data.issueNumber,
    issueUrl: data.issueUrl,
    createdAt: now,
    updatedAt: now,
  };
  await withTaskWriteLock(task.id, async () => {
    await writeTask(task);
  });
  return task;
}

export async function updateTask(
  id: string,
  updates: Partial<Pick<TaskItem, 'title' | 'description' | 'stage' | 'assignedTo' | 'status' | 'priority' | 'context' | 'tags' | 'parentTask' | 'dependsOn' | 'output' | 'branch' | 'prNumber' | 'prUrl' | 'issueNumber' | 'issueUrl' | 'completionReport' | 'checkoutSessionId' | 'checkoutAgentName' | 'checkedOutAt'>>,
): Promise<TaskItem | null> {
  return withTaskWriteLock(id, async () => {
    const task = await getTask(id);
    if (!task) return null;

    if (updates.title !== undefined) task.title = updates.title;
    if (updates.description !== undefined) task.description = updates.description;
    if (updates.stage !== undefined) task.stage = updates.stage.trim();
    if (updates.assignedTo !== undefined) task.assignedTo = updates.assignedTo;
    if (updates.status !== undefined) task.status = normalizeTaskStatus(updates.status) ?? task.status;
    if (updates.priority !== undefined) task.priority = updates.priority;
    if (updates.context !== undefined) task.context = updates.context;
    if (updates.tags !== undefined) task.tags = updates.tags;
    if (updates.parentTask !== undefined) task.parentTask = updates.parentTask;
    if (updates.dependsOn !== undefined) task.dependsOn = updates.dependsOn;
    if (updates.output !== undefined) task.output = updates.output;
    if (updates.branch !== undefined) task.branch = updates.branch;
    if (updates.prNumber !== undefined) task.prNumber = updates.prNumber;
    if (updates.prUrl !== undefined) task.prUrl = updates.prUrl;
    if (updates.issueNumber !== undefined) task.issueNumber = updates.issueNumber;
    if (updates.issueUrl !== undefined) task.issueUrl = updates.issueUrl;
    if (updates.completionReport !== undefined) task.completionReport = updates.completionReport;
    if (updates.checkoutSessionId !== undefined) task.checkoutSessionId = updates.checkoutSessionId || undefined;
    if (updates.checkoutAgentName !== undefined) task.checkoutAgentName = updates.checkoutAgentName || undefined;
    if (updates.checkedOutAt !== undefined) task.checkedOutAt = updates.checkedOutAt || undefined;
    task.updatedAt = new Date().toISOString();

    await writeTask(task);
    return task;
  });
}

/** Append a verification run to a task's completion report */
export async function addVerificationRun(
  id: string,
  run: VerificationRun,
): Promise<TaskItem | null> {
  return withTaskWriteLock(id, async () => {
    const task = await getTask(id);
    if (!task) return null;

    if (!task.completionReport) {
      task.completionReport = {
        agent: task.assignedTo || 'Unknown',
        generatedAt: new Date().toISOString(),
      };
    }
    if (!task.completionReport.verificationRuns) {
      task.completionReport.verificationRuns = [];
    }
    task.completionReport.verificationRuns.push(run);
    task.updatedAt = new Date().toISOString();

    await writeTask(task);
    return task;
  });
}

export async function deleteTask(id: string): Promise<boolean> {
  return withTaskWriteLock(id, async () => {
    try {
      await fs.unlink(taskFilePath(id));
      return true;
    } catch {
      return false;
    }
  });
}

export async function clearTasks(): Promise<void> {
  await ensureDir();
  const files = await fs.readdir(TASKS_DIR);
  for (const f of files) {
    if (f.endsWith('.json')) {
      await fs.unlink(path.join(TASKS_DIR, f));
    }
  }
}

/** Check if all dependencies of a task are satisfied */
export async function areDependenciesMet(taskId: string): Promise<{ met: boolean; blocking: string[] }> {
  const task = await getTask(taskId);
  if (!task?.dependsOn || task.dependsOn.length === 0) {
    return { met: true, blocking: [] };
  }
  const blocking = await getBlockingDependencyIds(task);
  return { met: blocking.length === 0, blocking };
}

/** Get tasks that are open AND have all dependencies satisfied (excludes checked-out tasks) */
export async function getReadyTasks(filters?: TaskFilters): Promise<TaskItem[]> {
  const allTasks = await listTasks(filters);
  const openTasks = allTasks.filter(t => t.status === 'open' && !checkoutLocks.has(t.id));
  const ready: TaskItem[] = [];
  for (const task of openTasks) {
    if (!task.dependsOn || task.dependsOn.length === 0) {
      ready.push(task);
      continue;
    }
    const { met } = await areDependenciesMet(task.id);
    if (met) ready.push(task);
  }
  return ready;
}

// ── Atomic checkout locks ────────────────────────────────────────────────────

export interface CheckoutLock {
  taskId: string;
  sessionId: string;
  agentName: string;
  lockedAt: number;  // Date.now() for fast staleness math
}

// In-memory lock map: taskId -> CheckoutLock
// Node.js is single-threaded, so Map check + set is inherently atomic.
const checkoutLocks = new Map<string, CheckoutLock>();

const STALE_LOCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

export function isLockStale(lock: CheckoutLock): boolean {
  return Date.now() - lock.lockedAt > STALE_LOCK_THRESHOLD_MS;
}

/** Atomically checkout a task. Returns the lock on success, or conflict info. */
export async function checkoutTask(
  taskId: string,
  sessionId: string,
  agentName: string,
): Promise<{ task: TaskItem; lock: CheckoutLock } | { conflict: CheckoutLock }> {
  // Step 1: Check in-memory lock map (atomic in single-threaded Node.js)
  const existingLock = checkoutLocks.get(taskId);
  if (existingLock) {
    // Idempotent: same session re-checking out the same task
    if (existingLock.sessionId === sessionId) {
      const task = await getTask(taskId);
      if (!task) {
        // Task was deleted while lock existed — clean up
        checkoutLocks.delete(taskId);
        return { conflict: existingLock };
      }
      return { task, lock: existingLock };
    }
    // Conflict: different session holds the lock
    return { conflict: existingLock };
  }

  // Step 2: Read the task from disk
  const task = await getTask(taskId);
  if (!task || (task.status !== 'open' && task.status !== 'in-progress')) {
    // Return a synthetic conflict if task doesn't exist or isn't available
    return {
      conflict: {
        taskId,
        sessionId: '',
        agentName: '',
        lockedAt: 0,
      },
    };
  }

  // Step 3: Check dependency satisfaction
  const { met, blocking } = await areDependenciesMet(taskId);
  if (!met) {
    return {
      conflict: {
        taskId,
        sessionId: '',
        agentName: `deps-unmet:${blocking.join(',')}`,
        lockedAt: 0,
      },
    };
  }

  // Step 4: Set the in-memory lock
  const now = Date.now();
  const lock: CheckoutLock = { taskId, sessionId, agentName, lockedAt: now };
  checkoutLocks.set(taskId, lock);

  // Step 5: Update task on disk
  try {
    const updated = await updateTask(taskId, {
      assignedTo: agentName,
      status: 'in-progress',
      checkoutSessionId: sessionId,
      checkoutAgentName: agentName,
      checkedOutAt: new Date(now).toISOString(),
    });
    if (!updated) {
      // Rollback in-memory lock on disk write failure
      checkoutLocks.delete(taskId);
      return {
        conflict: { taskId, sessionId: '', agentName: '', lockedAt: 0 },
      };
    }
    return { task: updated, lock };
  } catch (err) {
    // Rollback in-memory lock on disk write failure
    checkoutLocks.delete(taskId);
    throw err;
  }
}

/** Release a checkout lock. Returns true if released. */
export async function releaseCheckout(taskId: string, sessionId?: string): Promise<boolean> {
  const lock = checkoutLocks.get(taskId);
  if (!lock) return false;

  // If sessionId provided, only release if it matches
  if (sessionId && lock.sessionId !== sessionId) return false;

  // Remove from in-memory map
  checkoutLocks.delete(taskId);

  // Clear checkout fields on disk; reset in-progress tasks to open
  const task = await getTask(taskId);
  if (task) {
    const updates: Partial<Pick<TaskItem, 'checkoutSessionId' | 'checkoutAgentName' | 'checkedOutAt' | 'status' | 'assignedTo'>> = {
      checkoutSessionId: '',
      checkoutAgentName: '',
      checkedOutAt: '',
    };
    if (task.status === 'in-progress') {
      updates.status = 'open';
      updates.assignedTo = '';
    }
    await updateTask(taskId, updates);
  }

  return true;
}

/** Release all checkouts held by a given session (for session exit). */
export async function releaseSessionCheckouts(sessionId: string): Promise<string[]> {
  const releasedTaskIds: string[] = [];
  for (const [taskId, lock] of checkoutLocks) {
    if (lock.sessionId === sessionId) {
      await releaseCheckout(taskId, sessionId);
      releasedTaskIds.push(taskId);
    }
  }
  return releasedTaskIds;
}

/** Get the lock for a task (if any). */
export function getCheckoutLock(taskId: string): CheckoutLock | undefined {
  return checkoutLocks.get(taskId);
}

/** Get all active locks. */
export function getAllCheckoutLocks(): CheckoutLock[] {
  return Array.from(checkoutLocks.values());
}

export async function releaseCheckoutsForSessionIds(sessionIds: Iterable<string>): Promise<string[]> {
  const targets = new Set(Array.from(sessionIds).filter(Boolean));
  const releasedTaskIds: string[] = [];
  if (targets.size === 0) return releasedTaskIds;

  for (const [taskId, lock] of checkoutLocks) {
    if (!targets.has(lock.sessionId)) continue;
    await releaseCheckout(taskId, lock.sessionId);
    releasedTaskIds.push(taskId);
  }

  return releasedTaskIds;
}

/** Rehydrate lock map from disk on startup. */
export async function rehydrateCheckoutLocks(validSessionIds?: Set<string>): Promise<void> {
  await ensureDir();
  const files = await fs.readdir(TASKS_DIR);
  let rehydrated = 0;
  let pruned = 0;
  const enforceSessionIds = validSessionIds !== undefined;
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const data = await fs.readFile(path.join(TASKS_DIR, f), 'utf-8');
      const task: TaskItem = JSON.parse(data);
      if (task.checkoutSessionId && task.checkedOutAt) {
        const lockedAt = new Date(task.checkedOutAt).getTime();
        const hasInvalidTimestamp = !Number.isFinite(lockedAt);
        const missingSavedSession = enforceSessionIds && !validSessionIds.has(task.checkoutSessionId);
        const staleAtStartup = !hasInvalidTimestamp && (Date.now() - lockedAt > STALE_LOCK_THRESHOLD_MS);

        if (hasInvalidTimestamp || missingSavedSession || staleAtStartup) {
          await updateTask(task.id, {
            checkoutSessionId: '',
            checkoutAgentName: '',
            checkedOutAt: '',
            status: task.status === 'in-progress' ? 'open' : task.status,
            assignedTo: task.status === 'in-progress' ? '' : task.assignedTo,
          });
          pruned++;
          continue;
        }

        checkoutLocks.set(task.id, {
          taskId: task.id,
          sessionId: task.checkoutSessionId,
          agentName: task.checkoutAgentName || 'Unknown',
          lockedAt,
        });
        rehydrated++;
      }
    } catch {
      // Skip unparseable files
    }
  }
  if (rehydrated > 0) {
    console.log(`task-board: rehydrated ${rehydrated} checkout lock(s) from disk`);
  }
  if (pruned > 0) {
    console.log(`task-board: pruned ${pruned} stale or orphaned checkout lock(s) on startup`);
  }
}
