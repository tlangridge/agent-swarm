import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorktreeOverviewResponse } from '../types';

export function useWorktreeOverview(enabled = true, officeId?: string) {
  const [overview, setOverview] = useState<WorktreeOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  const inFlightRef = useRef(false);

  const refreshNow = useCallback(async () => {
    if (!enabled || inFlightRef.current) return;
    inFlightRef.current = true;

    try {
      const url = officeId
        ? `/api/worktrees/overview?officeId=${encodeURIComponent(officeId)}`
        : '/api/worktrees/overview';
      const res = await fetch(url);
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Worktree overview returned non-JSON (${res.status}). Check backend port/proxy configuration.`);
      }

      const data = await res.json();
      if (!res.ok) {
        const message = typeof data?.error === 'string' ? data.error : 'Failed to fetch worktree overview';
        throw new Error(message);
      }
      setOverview(data);
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch worktree overview';
      setError(message);
    } finally {
      if (!hasLoadedRef.current) {
        setLoading(false);
        hasLoadedRef.current = true;
      }
      inFlightRef.current = false;
    }
  }, [enabled, officeId]);

  useEffect(() => {
    if (!enabled) return;
    refreshNow();

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshNow();
      }
    }, 5000);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshNow();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, refreshNow]);

  return { overview, loading, error, refreshNow };
}
