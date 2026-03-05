import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const INSTANCE_ID_PATH = path.join(DATA_DIR, '_instance-id');

let cachedInstanceId: string | null = null;

function isValidInstanceId(value: string): boolean {
  return /^[A-Za-z0-9._-]{8,128}$/.test(value);
}

function readInstanceIdFromDisk(): string | null {
  try {
    const value = fs.readFileSync(INSTANCE_ID_PATH, 'utf-8').trim();
    return isValidInstanceId(value) ? value : null;
  } catch {
    return null;
  }
}

function writeInstanceIdToDisk(id: string): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(INSTANCE_ID_PATH, `${id}\n`, 'utf-8');
}

export function getServerInstanceId(): string {
  if (cachedInstanceId) return cachedInstanceId;

  const envOverride = process.env.SWARM_INSTANCE_ID?.trim();
  if (envOverride && isValidInstanceId(envOverride)) {
    cachedInstanceId = envOverride;
    return cachedInstanceId;
  }

  const diskValue = readInstanceIdFromDisk();
  if (diskValue) {
    cachedInstanceId = diskValue;
    return cachedInstanceId;
  }

  const generated = randomUUID();
  writeInstanceIdToDisk(generated);
  cachedInstanceId = generated;
  return cachedInstanceId;
}
