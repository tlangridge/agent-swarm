import { useState, useCallback, useMemo } from 'react';
import type { OfficeNotification } from '../types';

export function useNotifications() {
  const [notifications, setNotifications] = useState<OfficeNotification[]>([]);

  const addNotification = useCallback((n: Omit<OfficeNotification, 'read'>) => {
    const notification: OfficeNotification = { ...n, read: false };
    setNotifications(prev => [...prev.slice(-99), notification]);

    // Browser notification if tab is hidden
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(`[${n.officeName || 'Office'}] ${n.message}`);
    }
  }, []);

  const markRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const markAllReadForOffice = useCallback((officeId: string) => {
    setNotifications(prev => prev.map(n => n.officeId === officeId ? { ...n, read: true } : n));
  }, []);

  const unreadByOffice = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notifications) {
      if (!n.read) {
        map.set(n.officeId, (map.get(n.officeId) ?? 0) + 1);
      }
    }
    return map;
  }, [notifications]);

  return { notifications, addNotification, markRead, markAllReadForOffice, unreadByOffice };
}
