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
  soul?: string;
  memory?: string;
  instructions?: string;
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
    const data = await fs.readFile(path.join(OFFICES_DIR, f), 'utf-8');
    offices.push(JSON.parse(data));
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

export async function saveOffice(office: Office): Promise<void> {
  await ensureDir();
  await fs.writeFile(
    path.join(OFFICES_DIR, `${office.id}.json`),
    JSON.stringify(office, null, 2),
  );
}

export async function deleteOffice(id: string): Promise<boolean> {
  try {
    await fs.unlink(path.join(OFFICES_DIR, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}
