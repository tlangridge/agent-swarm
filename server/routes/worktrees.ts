import { Router } from 'express';
import { getProjectPath } from './project.js';
import { sessions } from '../pty-manager.js';
import { getMembers, getMembersByOffice } from '../services/swarm-registry.js';
import { getOffice } from '../services/office-store.js';
import {
  isGitRepo,
  listWorktrees,
  createWorktree,
  removeWorktree,
  getWorktreeStatus,
  normalizeFsPath,
} from '../services/worktree.js';

export const worktreeRoutes = Router();

/** Resolve project path: office-specific if officeId provided, otherwise global */
async function resolveProjectPath(officeId?: string): Promise<string> {
  if (officeId) {
    const office = await getOffice(officeId);
    if (office?.projectPath) return office.projectPath;
  }
  return getProjectPath();
}

// GET /api/worktrees — list worktrees for the current project path
worktreeRoutes.get('/', async (req, res) => {
  const officeId = typeof req.query.officeId === 'string' ? req.query.officeId : undefined;
  const projectPath = await resolveProjectPath(officeId);
  if (!projectPath) {
    return res.json({ worktrees: [], isGitRepo: false });
  }

  const gitRepo = isGitRepo(projectPath);
  if (!gitRepo) {
    return res.json({ worktrees: [], isGitRepo: false });
  }

  try {
    const worktrees = listWorktrees(projectPath);
    res.json({ worktrees, isGitRepo: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to list worktrees';
    res.status(500).json({ error: message });
  }
});

// GET /api/worktrees/overview — list worktree changes + active agents
worktreeRoutes.get('/overview', async (req, res) => {
  const officeId = typeof req.query.officeId === 'string' ? req.query.officeId : undefined;
  const projectPath = await resolveProjectPath(officeId);
  const generatedAt = new Date().toISOString();

  if (!projectPath) {
    return res.json({
      projectPath: '',
      isGitRepo: false,
      worktrees: [],
      generatedAt,
    });
  }

  if (!isGitRepo(projectPath)) {
    return res.json({
      projectPath,
      isGitRepo: false,
      worktrees: [],
      generatedAt,
    });
  }

  try {
    const allWorktrees = listWorktrees(projectPath);
    const normalizedByPath = new Map(
      allWorktrees.map(wt => [wt.path, normalizeFsPath(wt.path)]),
    );
    const members = officeId ? getMembersByOffice(officeId) : getMembers();
    const membersBySessionId = new Map(members.map(member => [member.sessionId, member]));

    const worktrees = allWorktrees.map(wt => {
      const activeAgents = Array.from(sessions.values())
        .filter(session => session.projectPath)
        .filter(session => normalizedByPath.get(wt.path) === normalizeFsPath(session.projectPath!))
        .map(session => {
          const member = membersBySessionId.get(session.id);
          return {
            sessionId: session.id,
            agentId: session.agentId,
            agentName: session.agentName,
            role: member?.role || 'worker',
            cliType: session.cliType,
          };
        })
        .sort((a, b) => {
          if (a.role === b.role) {
            return (a.agentName || '').localeCompare(b.agentName || '');
          }
          return a.role === 'lead' ? -1 : 1;
        });

      try {
        const status = getWorktreeStatus(wt.path, 500);
        return {
          path: wt.path,
          branch: wt.branch,
          head: wt.head,
          isMain: wt.isMain,
          changes: status.changes,
          totals: status.totals,
          truncated: status.truncated,
          totalDetected: status.totalDetected,
          activeAgents,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to read worktree status';
        return {
          path: wt.path,
          branch: wt.branch,
          head: wt.head,
          isMain: wt.isMain,
          changes: [],
          totals: {
            changed: 0,
            modified: 0,
            added: 0,
            deleted: 0,
            renamed: 0,
            untracked: 0,
            conflicted: 0,
          },
          truncated: false,
          totalDetected: 0,
          activeAgents,
          error: message,
        };
      }
    })
      .sort((a, b) => {
        if (a.activeAgents.length !== b.activeAgents.length) {
          return b.activeAgents.length - a.activeAgents.length;
        }
        return a.branch.localeCompare(b.branch);
      });

    res.json({
      projectPath,
      isGitRepo: true,
      worktrees,
      generatedAt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to build worktree overview';
    res.status(500).json({ error: message });
  }
});

// POST /api/worktrees — create a new worktree
worktreeRoutes.post('/', async (req, res) => {
  const officeId = typeof req.query.officeId === 'string' ? req.query.officeId : undefined;
  const projectPath = await resolveProjectPath(officeId);
  if (!projectPath) {
    return res.status(400).json({ error: 'No project path set' });
  }

  if (!isGitRepo(projectPath)) {
    return res.status(400).json({ error: 'Project path is not a git repository' });
  }

  const { branch, baseBranch } = req.body;
  if (!branch || typeof branch !== 'string') {
    return res.status(400).json({ error: "Missing 'branch' field" });
  }

  try {
    const worktree = createWorktree(projectPath, branch, baseBranch);
    res.json({ worktree });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create worktree';
    res.status(500).json({ error: message });
  }
});

// DELETE /api/worktrees/:branch — remove a worktree
worktreeRoutes.delete('/:branch', async (req, res) => {
  const officeId = typeof req.query.officeId === 'string' ? req.query.officeId : undefined;
  const projectPath = await resolveProjectPath(officeId);
  if (!projectPath) {
    return res.status(400).json({ error: 'No project path set' });
  }

  const { branch } = req.params;

  try {
    removeWorktree(projectPath, branch);
    res.json({ removed: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to remove worktree';
    res.status(500).json({ error: message });
  }
});
