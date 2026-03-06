import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { CliType, ExecutionMode, PermissionMode } from '../pty-manager.js';
import type { FunctionalRole } from './swarm-registry.js';
import { getDataPath } from './data-root.js';

const OFFICES_DIR = getDataPath('offices');
const LEGACY_DIR = getDataPath('rosters');

export interface PipelineStage {
  name: string;
  description: string;
  assignedRoles: FunctionalRole[];
}

export interface PipelineStagePlacement {
  beforeStage?: string;
  afterStage?: string;
  position?: number;
}

export interface OfficeSlot {
  name: string;
  functionalRole: FunctionalRole;
  cliType: CliType;
  permissionMode?: PermissionMode;
  executionMode?: ExecutionMode;
  useWorktree?: boolean;    // default true; false keeps agent on main checkout
  autoSpawn?: boolean;      // in 'demand' mode, spawn at badge-in? default true for lead only
  budgetCents?: number;     // per-slot cost budget in cents
  skills?: string[];        // extra skill names to inject (added to role defaults)
  soul?: string;
  memory?: string;
  instructions?: string;
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
  worktreeMode?: 'per-agent' | 'shared' | 'disabled';  // default 'per-agent'
  spawnMode?: 'eager' | 'demand';                       // default 'eager'
  idleDismissMinutes?: number;                           // 0 = disabled (default)
  totalBudgetCents?: number;                              // total office cost budget in cents
  soul?: string;
  memory?: string;
  instructions?: string;
  nextShiftNumber?: number;                    // incremented on shift close
  createdAt: string;
  updatedAt: string;
}

function normalizeStageKey(name: string): string {
  return name.trim().toLowerCase();
}

export function findPipelineStage(office: Office, stageName: string): PipelineStage | null {
  const key = normalizeStageKey(stageName);
  if (!key) return null;
  return office.pipeline?.find(stage => normalizeStageKey(stage.name) === key) ?? null;
}

export function getPipelineStageNames(office: Office): string[] {
  return (office.pipeline ?? []).map(stage => stage.name);
}

export function insertPipelineStage(
  office: Office,
  stage: PipelineStage,
  placement?: PipelineStagePlacement,
): { pipeline: PipelineStage[]; inserted: boolean } {
  const nextStage: PipelineStage = {
    name: stage.name.trim(),
    description: stage.description || '',
    assignedRoles: stage.assignedRoles ?? [],
  };
  if (!nextStage.name) {
    throw new Error('Stage name is required');
  }

  const existing = findPipelineStage(office, nextStage.name);
  if (existing) {
    return { pipeline: office.pipeline ?? [], inserted: false };
  }

  const current = [...(office.pipeline ?? [])];
  if (current.length === 0) {
    return { pipeline: [nextStage], inserted: true };
  }

  const selectors = [
    placement?.beforeStage ? 'beforeStage' : null,
    placement?.afterStage ? 'afterStage' : null,
    placement?.position != null ? 'position' : null,
  ].filter(Boolean);
  if (selectors.length !== 1) {
    throw new Error('Specify exactly one of beforeStage, afterStage, or position');
  }

  let index = -1;
  if (placement?.beforeStage) {
    index = current.findIndex(item => normalizeStageKey(item.name) === normalizeStageKey(placement.beforeStage!));
    if (index < 0) {
      throw new Error(`Unknown beforeStage "${placement.beforeStage}"`);
    }
  } else if (placement?.afterStage) {
    index = current.findIndex(item => normalizeStageKey(item.name) === normalizeStageKey(placement.afterStage!));
    if (index < 0) {
      throw new Error(`Unknown afterStage "${placement.afterStage}"`);
    }
    index += 1;
  } else if (placement?.position != null) {
    index = placement.position;
    if (!Number.isInteger(index) || index < 0 || index > current.length) {
      throw new Error(`Position must be between 0 and ${current.length}`);
    }
  }

  current.splice(index, 0, nextStage);
  return { pipeline: current, inserted: true };
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(OFFICES_DIR, { recursive: true });
}

/** Migrate legacy data/rosters/ → data/offices/ on first run */
export async function migrateFromRosters(): Promise<void> {
  try {
    await fs.access(LEGACY_DIR);
    try {
      await fs.access(OFFICES_DIR);
      // Both exist — skip migration
    } catch {
      // Legacy exists but new doesn't — rename
      await fs.rename(LEGACY_DIR, OFFICES_DIR);
      console.log('Migrated data/rosters/ → data/offices/');
    }
  } catch {
    // No legacy directory — nothing to migrate
  }
}

export async function listOffices(): Promise<Office[]> {
  await ensureDir();
  const files = await fs.readdir(OFFICES_DIR);
  const offices: Office[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const data = await fs.readFile(path.join(OFFICES_DIR, f), 'utf-8');
      offices.push(JSON.parse(data));
    } catch (err) {
      console.error(`office-store: failed to parse ${f}, skipping:`, err);
    }
  }
  return offices.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getOffice(id: string): Promise<Office | null> {
  try {
    const data = await fs.readFile(path.join(OFFICES_DIR, `${id}.json`), 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

// Per-office write mutex — serializes concurrent saves to the same office file
const writeLocks = new Map<string, Promise<unknown>>();

export async function saveOffice(office: Office): Promise<void> {
  const id = office.id;
  const prev = writeLocks.get(id) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(async () => {
    await ensureDir();
    const filePath = path.join(OFFICES_DIR, `${id}.json`);
    const tmpPath = filePath + `.${randomUUID()}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(office, null, 2));
    await fs.rename(tmpPath, filePath);
  });
  writeLocks.set(id, next);

  try {
    await next;
  } finally {
    if (writeLocks.get(id) === next) {
      writeLocks.delete(id);
    }
  }
}

export async function deleteOffice(id: string): Promise<boolean> {
  try {
    await fs.unlink(path.join(OFFICES_DIR, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}
