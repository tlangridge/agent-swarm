import { useState, useCallback, useRef, useEffect } from 'react';
import type { TaskItem } from '../types';

export function useTasks(connected: boolean, officeId?: string) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const params = officeId ? `?officeId=${officeId}` : '';
      const res = await fetch(`/api/swarm/tasks${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch {
      // ignore
    }
  }, [officeId]);

  // Auto-refresh every 5 seconds while connected
  useEffect(() => {
    if (!connected) return;
    fetchTasks();
    intervalRef.current = setInterval(fetchTasks, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [connected, fetchTasks]);

  const moveTask = useCallback(async (taskId: string, updates: { stage?: string; status?: string }) => {
    const res = await fetch(`/api/swarm/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Dashboard': 'true' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error('Failed to update task');
    await fetchTasks();
  }, [fetchTasks]);

  return { tasks, fetchTasks, moveTask };
}
