import { useState, useCallback } from 'react';
import type { Worktree } from '../types';

export function useWorktrees() {
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [isGitRepo, setIsGitRepo] = useState(false);

  const fetchWorktrees = useCallback(async () => {
    try {
      const res = await fetch('/api/worktrees');
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Worktrees endpoint returned non-JSON (${res.status})`);
      }
      const data = await res.json();
      setWorktrees(data.worktrees || []);
      setIsGitRepo(data.isGitRepo || false);
    } catch (err) {
      console.error('Failed to fetch worktrees:', err);
      setWorktrees([]);
      setIsGitRepo(false);
    }
  }, []);

  const createWorktree = useCallback(async (branch: string, baseBranch?: string): Promise<Worktree | null> => {
    try {
      const res = await fetch('/api/worktrees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch, baseBranch }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Worktree create returned non-JSON (${res.status})`);
      }
      if (!res.ok) {
        const data = await res.json();
        console.error('Failed to create worktree:', data.error);
        return null;
      }
      const data = await res.json();
      await fetchWorktrees();
      return data.worktree;
    } catch (err) {
      console.error('Failed to create worktree:', err);
      return null;
    }
  }, [fetchWorktrees]);

  const removeWorktree = useCallback(async (branch: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/worktrees/${encodeURIComponent(branch)}`, {
        method: 'DELETE',
      });
      if (!res.ok) return false;
      await fetchWorktrees();
      return true;
    } catch {
      return false;
    }
  }, [fetchWorktrees]);

  return { worktrees, isGitRepo, createWorktree, removeWorktree, refresh: fetchWorktrees };
}
