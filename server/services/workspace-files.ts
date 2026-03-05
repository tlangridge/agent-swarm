import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_DIR = path.join(__dirname, '../../data/workspace');

export interface WorkspaceFileEntry {
  path: string;
  description?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  sizeBytes: number;
}

export interface WorkspaceIndex {
  files: WorkspaceFileEntry[];
  updatedAt: string;
}

const ALLOWED_EXTENSIONS = new Set(['.md', '.txt', '.json', '.log']);

/**
 * Sanitize and validate a workspace file path.
 * Rejects absolute paths, `..` traversal, hidden files, and disallowed extensions.
 * Returns the normalized relative path or null if invalid.
 */
function sanitizePath(filePath: string): string | null {
  // Normalize separators to forward slash, then to OS-native
  const normalized = path.normalize(filePath.replace(/\\/g, '/'));

  // Reject absolute paths
  if (path.isAbsolute(normalized)) return null;

  // Reject `..` segments
  if (normalized.split(path.sep).some(seg => seg === '..')) return null;

  // Reject hidden files (any segment starting with `.`)
  if (normalized.split(path.sep).some(seg => seg.startsWith('.'))) return null;

  // Check extension
  const ext = path.extname(normalized).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return null;

  return normalized;
}

function officeDir(officeId: string): string {
  return path.join(BASE_DIR, officeId);
}

function indexPath(officeId: string): string {
  return path.join(officeDir(officeId), '_index.json');
}

async function ensureDir(officeId: string): Promise<void> {
  await fs.mkdir(officeDir(officeId), { recursive: true });
}

async function loadIndex(officeId: string): Promise<WorkspaceIndex> {
  try {
    const data = await fs.readFile(indexPath(officeId), 'utf-8');
    return JSON.parse(data);
  } catch {
    return { files: [], updatedAt: new Date().toISOString() };
  }
}

async function saveIndex(officeId: string, index: WorkspaceIndex): Promise<void> {
  index.updatedAt = new Date().toISOString();
  await fs.writeFile(indexPath(officeId), JSON.stringify(index, null, 2));
}

/**
 * List all files in the workspace for a given office.
 * Creates an empty index if one doesn't exist yet.
 */
export async function listFiles(officeId: string): Promise<WorkspaceIndex> {
  await ensureDir(officeId);
  return loadIndex(officeId);
}

/**
 * Read a file's content and metadata from the workspace.
 * Returns null if the path is invalid or the file doesn't exist.
 */
export async function readFile(
  officeId: string,
  filePath: string,
): Promise<{ content: string; entry: WorkspaceFileEntry } | null> {
  const safe = sanitizePath(filePath);
  if (!safe) return null;

  const index = await loadIndex(officeId);
  const entry = index.files.find(f => f.path === safe);
  if (!entry) return null;

  try {
    const content = await fs.readFile(path.join(officeDir(officeId), safe), 'utf-8');
    return { content, entry };
  } catch {
    return null;
  }
}

/**
 * Write (create or update) a file in the workspace.
 * Updates the index with metadata.
 */
export async function writeFile(
  officeId: string,
  filePath: string,
  content: string,
  author: string,
  description?: string,
): Promise<WorkspaceFileEntry> {
  const safe = sanitizePath(filePath);
  if (!safe) throw new Error(`Invalid file path: ${filePath}`);

  await ensureDir(officeId);

  // Ensure subdirectories exist for nested paths
  const fullPath = path.join(officeDir(officeId), safe);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  await fs.writeFile(fullPath, content, 'utf-8');

  const now = new Date().toISOString();
  const sizeBytes = Buffer.byteLength(content, 'utf-8');

  const index = await loadIndex(officeId);
  const existing = index.files.find(f => f.path === safe);

  let entry: WorkspaceFileEntry;

  if (existing) {
    existing.updatedBy = author;
    existing.updatedAt = now;
    existing.sizeBytes = sizeBytes;
    if (description !== undefined) existing.description = description;
    entry = existing;
  } else {
    entry = {
      path: safe,
      description,
      createdBy: author,
      updatedBy: author,
      createdAt: now,
      updatedAt: now,
      sizeBytes,
    };
    index.files.push(entry);
  }

  await saveIndex(officeId, index);
  return entry;
}

/**
 * Append content to an existing file (or create it).
 * Atomic append prevents race conditions when multiple agents write concurrently.
 */
export async function appendFile(
  officeId: string,
  filePath: string,
  content: string,
  author: string,
  separator?: string,
): Promise<WorkspaceFileEntry> {
  const safe = sanitizePath(filePath);
  if (!safe) throw new Error(`Invalid file path: ${filePath}`);

  await ensureDir(officeId);

  const fullPath = path.join(officeDir(officeId), safe);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  let existing = '';
  try { existing = await fs.readFile(fullPath, 'utf-8'); } catch { /* new file */ }

  const sep = separator || '\n\n';
  const merged = existing ? existing + sep + content : content;
  await fs.writeFile(fullPath, merged, 'utf-8');

  const now = new Date().toISOString();
  const sizeBytes = Buffer.byteLength(merged, 'utf-8');

  const index = await loadIndex(officeId);
  const existingEntry = index.files.find(f => f.path === safe);

  let entry: WorkspaceFileEntry;

  if (existingEntry) {
    existingEntry.updatedBy = author;
    existingEntry.updatedAt = now;
    existingEntry.sizeBytes = sizeBytes;
    entry = existingEntry;
  } else {
    entry = {
      path: safe,
      createdBy: author,
      updatedBy: author,
      createdAt: now,
      updatedAt: now,
      sizeBytes,
    };
    index.files.push(entry);
  }

  await saveIndex(officeId, index);
  return entry;
}

/**
 * Delete a file from the workspace and remove it from the index.
 * Returns true if the file was deleted, false if it wasn't found.
 */
export async function deleteFile(officeId: string, filePath: string): Promise<boolean> {
  const safe = sanitizePath(filePath);
  if (!safe) return false;

  const index = await loadIndex(officeId);
  const idx = index.files.findIndex(f => f.path === safe);
  if (idx === -1) return false;

  index.files.splice(idx, 1);
  await saveIndex(officeId, index);

  try {
    await fs.unlink(path.join(officeDir(officeId), safe));
  } catch {
    // File may already be gone from disk
  }

  return true;
}
