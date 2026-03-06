import { EventEmitter } from 'events';
import type { CliType, ExecutionMode } from '../pty-manager.js';

export type SwarmRole = 'lead' | 'worker';

export type FunctionalRole =
  | 'product-manager'
  | 'architect'
  | 'designer'
  | 'developer'
  | 'tester'
  | 'code-reviewer'
  | 'devops'
  | 'tech-lead';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface SwarmMember {
  sessionId: string;
  officeId: string;
  agentId: string | null;
  agentName: string | null;
  agentEmail: string | null;
  cliType: CliType;
  executionMode: ExecutionMode;
  role: SwarmRole;
  functionalRole: FunctionalRole | null;
  joinedAt: string;
  // Circuit breaker state
  taskSuccessCount: number;
  taskFailureCount: number;
  consecutiveFailures: number;
  circuitState: CircuitState;
  circuitOpenedAt?: string;
}

const members = new Map<string, SwarmMember>();

export const swarmEvents = new EventEmitter();

export function addMember(member: Omit<SwarmMember, 'taskSuccessCount' | 'taskFailureCount' | 'consecutiveFailures' | 'circuitState'> & Partial<Pick<SwarmMember, 'taskSuccessCount' | 'taskFailureCount' | 'consecutiveFailures' | 'circuitState'>>): void {
  const full: SwarmMember = {
    ...member,
    taskSuccessCount: member.taskSuccessCount ?? 0,
    taskFailureCount: member.taskFailureCount ?? 0,
    consecutiveFailures: member.consecutiveFailures ?? 0,
    circuitState: member.circuitState ?? 'closed',
  };
  members.set(full.sessionId, full);
  swarmEvents.emit('member:joined', full);
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

  // If promoting to lead, demote the current lead within the same office first
  if (role === 'lead') {
    for (const [id, m] of members) {
      if (m.officeId === member.officeId && m.role === 'lead' && id !== sessionId) {
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

export function getLeadSessionId(officeId?: string): string | null {
  for (const [id, m] of members) {
    if (officeId !== undefined && m.officeId !== officeId) continue;
    if (m.role === 'lead') return id;
  }
  return null;
}

export function getMemberByName(name: string, officeId?: string): SwarmMember | undefined {
  const lower = name.toLowerCase();
  for (const m of members.values()) {
    if (officeId !== undefined && m.officeId !== officeId) continue;
    if (m.agentName?.toLowerCase() === lower) return m;
  }
  return undefined;
}

export function getMembersByOffice(officeId: string): SwarmMember[] {
  return Array.from(members.values()).filter(m => m.officeId === officeId);
}

export function getLeadSessionIdForOffice(officeId: string): string | null {
  for (const m of members.values()) {
    if (m.officeId === officeId && m.role === 'lead') return m.sessionId;
  }
  return null;
}

/**
 * Office coordinator routing:
 * 1) Product Manager (if present) handles day-to-day coordination
 * 2) Fallback to lead when no PM is active
 */
export function getCoordinatorSessionIdForOffice(officeId: string): string | null {
  for (const m of members.values()) {
    if (m.officeId === officeId && m.functionalRole === 'product-manager') {
      return m.sessionId;
    }
  }
  return getLeadSessionIdForOffice(officeId);
}

// ── Circuit breaker ──────────────────────────────────────────────────────────

const CIRCUIT_BREAKER_THRESHOLD = 3;         // consecutive failures to open
const CIRCUIT_BREAKER_COOLDOWN_MS = 300_000; // 5 minutes

export function recordTaskSuccess(sessionId: string): void {
  const member = members.get(sessionId);
  if (!member) return;
  member.taskSuccessCount++;
  member.consecutiveFailures = 0;
  if (member.circuitState === 'half-open') {
    member.circuitState = 'closed';
    swarmEvents.emit('circuit:closed', member);
  }
}

export function recordTaskFailure(sessionId: string): void {
  const member = members.get(sessionId);
  if (!member) return;
  member.taskFailureCount++;
  member.consecutiveFailures++;
  if (member.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD && member.circuitState === 'closed') {
    member.circuitState = 'open';
    member.circuitOpenedAt = new Date().toISOString();
    swarmEvents.emit('circuit:opened', member);
  }
}

export function canAcceptTask(sessionId: string): boolean {
  const member = members.get(sessionId);
  if (!member) return false;
  if (member.circuitState === 'closed') return true;
  if (member.circuitState === 'open') {
    const openedAt = member.circuitOpenedAt ? new Date(member.circuitOpenedAt).getTime() : 0;
    if (Date.now() - openedAt > CIRCUIT_BREAKER_COOLDOWN_MS) {
      member.circuitState = 'half-open';
      return true; // Allow one probe task
    }
    return false;
  }
  // half-open: already allowed the probe
  return false;
}
