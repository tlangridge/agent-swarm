import { useState, useCallback } from 'react';
import type { Office, OfficeSlot, PipelineStage, CronJob, ShiftState } from '../types';

export function useOffices() {
  const [offices, setOffices] = useState<Office[]>([]);
  const [activeShifts, setActiveShifts] = useState<Map<string, ShiftState>>(new Map());
  const [loading, setLoading] = useState(false);

  const fetchOffices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/offices');
      const data = await res.json();
      setOffices(data.offices || []);
      // Server now returns activeShifts (array) instead of activeShift (singular)
      const shiftsArr: ShiftState[] = data.activeShifts || (data.activeShift ? [data.activeShift] : []);
      const shiftsMap = new Map<string, ShiftState>();
      for (const shift of shiftsArr) {
        if (shift.status !== 'ended') {
          shiftsMap.set(shift.officeId, shift);
        }
      }
      setActiveShifts(shiftsMap);
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
    setActiveShifts(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    return data;
  }, []);

  return { offices, activeShifts, setActiveShifts, loading, fetchOffices, createOffice, updateOffice, deleteOffice, badgeIn, badgeOut };
}
