import { useState, useCallback } from 'react';
import type { Office, OfficeSlot, PipelineStage, CronJob, ShiftState } from '../types';

export function useOffices() {
  const [offices, setOffices] = useState<Office[]>([]);
  const [activeShift, setActiveShift] = useState<ShiftState | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchOffices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/offices');
      const data = await res.json();
      setOffices(data.offices || []);
      setActiveShift(data.activeShift || null);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const createOffice = useCallback(async (name: string, slots: OfficeSlot[], pipeline?: PipelineStage[], context?: { projectPath?: string; soul?: string; memory?: string; instructions?: string; cronJobs?: CronJob[] }) => {
    const res = await fetch('/api/offices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, slots, pipeline, ...context }),
    });
    const office = await res.json();
    await fetchOffices();
    return office as Office;
  }, [fetchOffices]);

  const updateOffice = useCallback(async (id: string, updates: Partial<Pick<Office, 'name' | 'slots' | 'pipeline' | 'cronJobs' | 'projectPath' | 'soul' | 'memory' | 'instructions'>>) => {
    await fetch(`/api/offices/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    await fetchOffices();
  }, [fetchOffices]);

  const deleteOffice = useCallback(async (id: string) => {
    await fetch(`/api/offices/${id}`, { method: 'DELETE' });
    await fetchOffices();
  }, [fetchOffices]);

  const badgeIn = useCallback(async (id: string) => {
    const res = await fetch(`/api/offices/${id}/badge-in`, { method: 'POST' });
    return res.json();
  }, []);

  const badgeOut = useCallback(async (id: string) => {
    const res = await fetch(`/api/offices/${id}/badge-out`, { method: 'POST' });
    const data = await res.json();
    setActiveShift(null);
    return data;
  }, []);

  return { offices, activeShift, setActiveShift, loading, fetchOffices, createOffice, updateOffice, deleteOffice, badgeIn, badgeOut };
}
