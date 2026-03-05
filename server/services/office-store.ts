import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { CliType, ExecutionMode, PermissionMode } from '../pty-manager.js';
import type { FunctionalRole } from './swarm-registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OFFICES_DIR = path.join(__dirname, '../../data/offices');
const LEGACY_DIR = path.join(__dirname, '../../data/rosters');

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
const writeLocks = new Map<string, Promise<void>>();

export async function saveOffice(office: Office): Promise<void> {
  const id = office.id;
  const prev = writeLocks.get(id) ?? Promise.resolve();
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const gate = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  writeLocks.set(id, gate);

  await prev;
  try {
    await ensureDir();
    const filePath = path.join(OFFICES_DIR, `${id}.json`);
    const tmpPath = filePath + `.${randomUUID()}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(office, null, 2));
    await fs.rename(tmpPath, filePath);
    resolve();
  } catch (err) {
    reject(err);
    throw err;
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
