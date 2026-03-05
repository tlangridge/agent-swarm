import { useState, useCallback, useRef, useEffect } from 'react';
import type { TaskItem } from '../types';

export function useTasks(connected: boolean, officeId?: string) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTasks = useCallback(async () => {
    if (!officeId) {
      setTasks([]);
      return;
    }

    try {
      const res = await fetch(`/api/swarm/tasks?officeId=${encodeURIComponent(officeId)}`);
      if (!res.ok) return;
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch {
      // ignore
    }
  }, [officeId]);

  // Auto-refresh every 5 seconds while connected
  useEffect(() => {
    if (!connected || !officeId) {
      setTasks([]);
      return;
    }
    fetchTasks();
    intervalRef.current = setInterval(fetchTasks, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [connected, fetchTasks, officeId]);

  const moveTask = useCallback(async (taskId: string, updates: { stage?: string; status?: string }) => {
    if (!officeId) throw new Error('Missing office context');

    const res = await fetch(`/api/swarm/tasks/${taskId}?officeId=${encodeURIComponent(officeId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Dashboard': 'true' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error('Failed to update task');
    await fetchTasks();
  }, [fetchTasks, officeId]);

  return { tasks, fetchTasks, moveTask };
}
