import { Router } from 'express';
import { existsSync, statSync } from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

export const projectRoutes = Router();

// Module-level state — persists for the lifetime of the server process
let projectPath = '';

export function getProjectPath(): string {
  return projectPath;
}

export function setProjectPath(p: string): void {
  projectPath = p;
}

function validateProjectPathInput(input: unknown): { valid: true; projectPath: string } | { valid: false; error: string } {
  if (typeof input !== 'string') {
    return { valid: false, error: 'projectPath must be a string' };
  }

  const normalized = input.trim();

  // Allow clearing the path
  if (normalized === '') {
    return { valid: true, projectPath: '' };
  }

  if (!path.isAbsolute(normalized)) {
    return { valid: false, error: 'projectPath must be an absolute path' };
  }

  if (!existsSync(normalized)) {
    return { valid: false, error: 'Directory does not exist' };
  }

  try {
    const stat = statSync(normalized);
    if (!stat.isDirectory()) {
      return { valid: false, error: 'Path is not a directory' };
    }
  } catch {
    return { valid: false, error: 'Cannot access directory' };
  }

  return { valid: true, projectPath: normalized };
}

function escapeAppleScriptString(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function pickDirectoryFromOs(initialPath: string): { cancelled: true } | { cancelled: false; projectPath: string } {
  if (process.platform === 'darwin') {
    const quoted = escapeAppleScriptString(initialPath);
    const output = execFileSync(
      'osascript',
      [
        '-e',
        `set startFolder to POSIX file "${quoted}"`,
        '-e',
        'set chosenFolder to choose folder with prompt "Select project folder" default location startFolder',
        '-e',
        'POSIX path of chosenFolder',
      ],
      { encoding: 'utf-8' },
    );
    return { cancelled: false, projectPath: output.trim() };
  }

  if (process.platform === 'linux') {
    const output = execFileSync(
      'zenity',
      ['--file-selection', '--directory', '--title=Select project folder', `--filename=${initialPath}/`],
      { encoding: 'utf-8' },
    );
    return { cancelled: false, projectPath: output.trim() };
  }

  throw new Error(`Folder picker is not supported on ${process.platform}`);
}

// GET /api/project — return the current project path
projectRoutes.get('/', (_req, res) => {
  res.json({ projectPath });
});

// PUT /api/project — set the project path
projectRoutes.put('/', (req, res) => {
  const result = validateProjectPathInput(req.body?.projectPath);
  if (!result.valid) {
    return res.status(400).json({ error: result.error });
  }

  projectPath = result.projectPath;
  res.json({ projectPath, valid: true });
});

// POST /api/project/pick — open native OS folder picker and store result
projectRoutes.post('/pick', (_req, res) => {
  const initialPath = projectPath || process.env.HOME || '/';

  try {
    const picked = pickDirectoryFromOs(initialPath);
    if (picked.cancelled) {
      return res.json({ cancelled: true });
    }

    const result = validateProjectPathInput(picked.projectPath);
    if (!result.valid) {
      return res.status(400).json({ error: result.error });
    }

    projectPath = result.projectPath;
    return res.json({ projectPath, valid: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to pick folder';
    const asNodeErr = err as NodeJS.ErrnoException & { status?: number };

    if (asNodeErr?.status === 1 || asNodeErr?.message?.includes('User canceled')) {
      return res.json({ cancelled: true });
    }
    if (asNodeErr?.code === 'ENOENT') {
      return res.status(501).json({ error: 'Native folder picker is unavailable on this system' });
    }
    return res.status(500).json({ error: message });
  }
});
