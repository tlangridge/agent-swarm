import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolveSkillPaths } from './skill-registry.js';

// Track temp dirs by sessionId for cleanup
const sessionSkillDirs = new Map<string, string>();

/**
 * Create a temp directory with .claude/skills/ structure containing symlinks
 * (or copies for Docker mode) to the selected skill directories.
 *
 * Returns the temp dir path to pass to `--add-dir`, or null if no skills.
 */
export function createSkillDir(
  sessionId: string,
  skillNames: string[],
  useHardCopy?: boolean,
): string | null {
  if (skillNames.length === 0) return null;

  const skillPaths = resolveSkillPaths(skillNames);
  if (skillPaths.length === 0) return null;

  // Clean up any existing skill dir for this session
  cleanupSkillDir(sessionId);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-skills-'));
  const skillsTarget = path.join(tmpDir, '.claude', 'skills');
  fs.mkdirSync(skillsTarget, { recursive: true });

  for (const skillPath of skillPaths) {
    const skillName = path.basename(skillPath);
    const linkTarget = path.join(skillsTarget, skillName);

    try {
      if (useHardCopy) {
        // Docker mode: copy instead of symlink (containers can't follow host symlinks)
        fs.cpSync(skillPath, linkTarget, { recursive: true });
      } else {
        // Local mode: symlink for live editing support
        fs.symlinkSync(skillPath, linkTarget, 'dir');
      }
    } catch (err: unknown) {
      // Fall back to copy on symlink failure (e.g., network mounts with EPERM)
      if (!useHardCopy) {
        try {
          fs.cpSync(skillPath, linkTarget, { recursive: true });
        } catch (copyErr) {
          console.warn(`Failed to link or copy skill ${skillName}:`, copyErr);
        }
      } else {
        console.warn(`Failed to copy skill ${skillName}:`, err);
      }
    }
  }

  sessionSkillDirs.set(sessionId, tmpDir);
  return tmpDir;
}

/** Clean up the temp skill directory for a specific session */
export function cleanupSkillDir(sessionId: string): void {
  const dir = sessionSkillDirs.get(sessionId);
  if (!dir) return;

  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`Failed to clean up skill dir for session ${sessionId}:`, err);
  }
  sessionSkillDirs.delete(sessionId);
}

/** Clean up all tracked temp skill directories */
export function cleanupAllSkillDirs(): void {
  for (const [sessionId, dir] of sessionSkillDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`Failed to clean up skill dir for session ${sessionId}:`, err);
    }
  }
  sessionSkillDirs.clear();
}

/**
 * Startup sweep: remove orphaned swarm-skills-* temp dirs from previous runs.
 * Call this at server startup before any sessions are created.
 */
export function cleanupOrphanedSkillDirs(): void {
  const tmpDir = os.tmpdir();
  try {
    const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
    let cleaned = 0;
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('swarm-skills-')) {
        const fullPath = path.join(tmpDir, entry.name);
        try {
          fs.rmSync(fullPath, { recursive: true, force: true });
          cleaned++;
        } catch {
          // Best effort -- may be in use by another process
        }
      }
    }
    if (cleaned > 0) {
      console.log(`Cleaned up ${cleaned} orphaned swarm-skills-* temp dir(s)`);
    }
  } catch (err) {
    console.warn('Failed to sweep orphaned skill dirs:', err);
  }
}
