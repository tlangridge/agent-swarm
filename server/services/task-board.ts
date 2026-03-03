import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = path.join(__dirname, '../../data/tasks');

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

async function ensureDir(): Promise<void> {
  await fs.mkdir(TASKS_DIR, { recursive: true });
}

export async function listTasks(filters?: TaskFilters): Promise<TaskItem[]> {
  await ensureDir();
  const files = await fs.readdir(TASKS_DIR);
  let result: TaskItem[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const data = await fs.readFile(path.join(TASKS_DIR, f), 'utf-8');
      const task = JSON.parse(data);
      // Normalize "archived" → "done" (agents sometimes use "archived")
      if (task.status === 'archived') task.status = 'done';
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
    const data = await fs.readFile(path.join(TASKS_DIR, `${id}.json`), 'utf-8');
    return JSON.parse(data);
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
  await fs.writeFile(path.join(TASKS_DIR, `${task.id}.json`), JSON.stringify(task, null, 2));
  return task;
}

export async function updateTask(
  id: string,
  updates: Partial<Pick<TaskItem, 'title' | 'description' | 'stage' | 'assignedTo' | 'status' | 'priority' | 'context' | 'tags' | 'parentTask' | 'dependsOn' | 'output' | 'branch' | 'prNumber' | 'prUrl' | 'issueNumber' | 'issueUrl' | 'completionReport'>>,
): Promise<TaskItem | null> {
  const task = await getTask(id);
  if (!task) return null;

  if (updates.title !== undefined) task.title = updates.title;
  if (updates.description !== undefined) task.description = updates.description;
  if (updates.stage !== undefined) task.stage = updates.stage;
  if (updates.assignedTo !== undefined) task.assignedTo = updates.assignedTo;
  if (updates.status !== undefined) task.status = (updates.status as string) === 'archived' ? 'done' : updates.status;
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
  task.updatedAt = new Date().toISOString();

  await fs.writeFile(path.join(TASKS_DIR, `${task.id}.json`), JSON.stringify(task, null, 2));
  return task;
}

/** Append a verification run to a task's completion report */
export async function addVerificationRun(
  id: string,
  run: VerificationRun,
): Promise<TaskItem | null> {
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

  await fs.writeFile(path.join(TASKS_DIR, `${task.id}.json`), JSON.stringify(task, null, 2));
  return task;
}

export async function deleteTask(id: string): Promise<boolean> {
  try {
    await fs.unlink(path.join(TASKS_DIR, `${id}.json`));
    return true;
  } catch {
    return false;
  }
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
  const blocking: string[] = [];
  for (const depId of task.dependsOn) {
    const dep = await getTask(depId);
    if (!dep || dep.status !== 'done') {
      blocking.push(depId);
    }
  }
  return { met: blocking.length === 0, blocking };
}

/** Get tasks that are open AND have all dependencies satisfied */
export async function getReadyTasks(filters?: TaskFilters): Promise<TaskItem[]> {
  const allTasks = await listTasks(filters);
  const openTasks = allTasks.filter(t => t.status === 'open');
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
