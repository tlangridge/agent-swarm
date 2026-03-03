import { nanoid } from 'nanoid';
import { swarmEvents } from './swarm-registry.js';

export type NotificationType = 'shift_ended' | 'agent_failed' | 'shift_review' | 'all_tasks_done';

export interface OfficeNotification {
  id: string;
  officeId: string;
  officeName: string;
  type: NotificationType;
  message: string;
  timestamp: string;
}

const recentNotifications: OfficeNotification[] = [];
const MAX_NOTIFICATIONS = 100;

function emit(notification: OfficeNotification): void {
  recentNotifications.push(notification);
  if (recentNotifications.length > MAX_NOTIFICATIONS) {
    recentNotifications.shift();
  }
  swarmEvents.emit('office:notification', notification);
}

export function getNotifications(officeId?: string): OfficeNotification[] {
  if (officeId) return recentNotifications.filter(n => n.officeId === officeId);
  return [...recentNotifications];
}

export function initNotificationManager(): void {
  swarmEvents.on('shift:status', ({ shift }) => {
    if (!shift) return;
    if (shift.status === 'ended') {
      emit({
        id: nanoid(8),
        officeId: shift.officeId,
        officeName: shift.officeName,
        type: 'shift_ended',
        message: `Shift ended for "${shift.officeName}"`,
        timestamp: new Date().toISOString(),
      });
    }
    if (shift.status === 'review') {
      emit({
        id: nanoid(8),
        officeId: shift.officeId,
        officeName: shift.officeName,
        type: 'shift_review',
        message: `"${shift.officeName}" is ready for review`,
        timestamp: new Date().toISOString(),
      });
    }
  });

  swarmEvents.on('shift:progress', ({ officeId, slotName, status, error }) => {
    if (status === 'failed' && officeId) {
      emit({
        id: nanoid(8),
        officeId,
        officeName: '',  // will be enriched by client
        type: 'agent_failed',
        message: `Agent "${slotName}" failed${error ? `: ${error}` : ''}`,
        timestamp: new Date().toISOString(),
      });
    }
  });
}
