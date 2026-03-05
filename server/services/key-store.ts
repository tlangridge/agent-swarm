import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import path from 'path';
import { getDataPath } from './data-root.js';

const KEYS_DIR = getDataPath('keys');
const OFFICES_KEYS_DIR = path.join(KEYS_DIR, 'offices');
const GLOBAL_FILE = path.join(KEYS_DIR, 'global.json');

const KNOWN_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'AGENTMAIL_API_KEY',
] as const;

export type KnownKeyName = typeof KNOWN_KEYS[number];

export function ensureKeyDirs(): void {
  mkdirSync(KEYS_DIR, { recursive: true });
  mkdirSync(OFFICES_KEYS_DIR, { recursive: true });
}

function readJsonFile(filePath: string): Record<string, string> {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function atomicWrite(filePath: string, data: Record<string, string>): void {
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, filePath);
}

export function loadGlobalKeys(): Record<string, string> {
  return readJsonFile(GLOBAL_FILE);
}

export function saveGlobalKeys(keys: Record<string, string>): void {
  ensureKeyDirs();
  atomicWrite(GLOBAL_FILE, keys);
}

function officeFilePath(officeId: string): string {
  return path.join(OFFICES_KEYS_DIR, `${officeId}.json`);
}

export function loadOfficeKeys(officeId: string): Record<string, string> {
  return readJsonFile(officeFilePath(officeId));
}

export function saveOfficeKeys(officeId: string, keys: Record<string, string>): void {
  ensureKeyDirs();
  atomicWrite(officeFilePath(officeId), keys);
}

/**
 * Resolve keys for a session using 3-tier priority:
 *   office key (highest) → global key → process.env (lowest)
 * Only returns the 5 known key names. Skips empty/undefined values.
 */
export function resolveKeysForSession(officeId?: string): Record<string, string> {
  const globalKeys = loadGlobalKeys();
  const officeKeys = officeId ? loadOfficeKeys(officeId) : {};
  const result: Record<string, string> = {};

  for (const name of KNOWN_KEYS) {
    const value = officeKeys[name] || globalKeys[name] || process.env[name];
    if (value) {
      result[name] = value;
    }
  }

  return result;
}

/**
 * Mask a key value for safe display.
 * Shows first 6 + last 4 chars with "..." in the middle.
 * For short values (< 10 chars), shows first 2 + last 2.
 */
export function maskKey(value: string): string {
  if (value.length < 10) {
    if (value.length <= 4) return '****';
    return value.slice(0, 2) + '...' + value.slice(-2);
  }
  return value.slice(0, 6) + '...' + value.slice(-4);
}

/**
 * Return resolved keys with their source tier, masked for display.
 */
export function getResolvedKeysWithSource(officeId: string): Array<{ name: string; maskedValue: string; source: 'office' | 'global' | 'env' }> {
  const globalKeys = loadGlobalKeys();
  const officeKeys = loadOfficeKeys(officeId);
  const result: Array<{ name: string; maskedValue: string; source: 'office' | 'global' | 'env' }> = [];

  for (const name of KNOWN_KEYS) {
    let value: string | undefined;
    let source: 'office' | 'global' | 'env';

    if (officeKeys[name]) {
      value = officeKeys[name];
      source = 'office';
    } else if (globalKeys[name]) {
      value = globalKeys[name];
      source = 'global';
    } else if (process.env[name]) {
      value = process.env[name];
      source = 'env';
    } else {
      continue;
    }

    result.push({ name, maskedValue: maskKey(value), source });
  }

  return result;
}
