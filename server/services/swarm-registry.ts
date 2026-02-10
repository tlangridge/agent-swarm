import { EventEmitter } from 'events';
import type { CliType, ExecutionMode } from '../pty-manager.js';

export type SwarmRole = 'lead' | 'worker';

export interface SwarmMember {
  sessionId: string;
  agentId: string | null;
  agentName: string | null;
  agentEmail: string | null;
  cliType: CliType;
  executionMode: ExecutionMode;
  role: SwarmRole;
  joinedAt: string;
}

const members = new Map<string, SwarmMember>();

export const swarmEvents = new EventEmitter();

export function addMember(member: SwarmMember): void {
  members.set(member.sessionId, member);
  swarmEvents.emit('member:joined', member);
}

export function removeMember(sessionId: string): void {
  const member = members.get(sessionId);
  if (member) {
    members.delete(sessionId);
    swarmEvents.emit('member:left', member);
  }
}

export function setRole(sessionId: string, role: SwarmRole): void {
  const member = members.get(sessionId);
  if (!member) return;

  // If promoting to lead, demote the current lead first
  if (role === 'lead') {
    for (const [id, m] of members) {
      if (m.role === 'lead' && id !== sessionId) {
        m.role = 'worker';
        swarmEvents.emit('member:role-changed', m);
      }
    }
  }

  member.role = role;
  swarmEvents.emit('member:role-changed', member);
}

export function getMember(sessionId: string): SwarmMember | undefined {
  return members.get(sessionId);
}

export function getMembers(): SwarmMember[] {
  return Array.from(members.values());
}

export function getLeadSessionId(): string | null {
  for (const [id, m] of members) {
    if (m.role === 'lead') return id;
  }
  return null;
}

export function getMemberByName(name: string): SwarmMember | undefined {
  const lower = name.toLowerCase();
  for (const m of members.values()) {
    if (m.agentName?.toLowerCase() === lower) return m;
  }
  return undefined;
}
