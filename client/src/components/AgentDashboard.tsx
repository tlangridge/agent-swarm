import { useMemo, useState, useEffect, useCallback } from 'react';
import AgentCard from './AgentCard';
import type { TerminalSession, SwarmMember, ShiftState, ShiftSlotState, TaskItem, SwarmRole, AgentStructuredStatus } from '../types';

interface AgentDashboardProps {
  sessions: Map<string, TerminalSession>;
  swarmMembers: SwarmMember[];
  leadSessionId: string | null;
  activeShift: ShiftState | null;
  officeId?: string | null;
  tasks: TaskItem[];
  outputPreviews: Map<string, string[]>;
  lastActivityAt: Map<string, number>;
  onFocusSession: (sessionId: string) => void;
  onSetRole: (sessionId: string, role: SwarmRole) => void;
  onRestartSession: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
}

export default function AgentDashboard({
  sessions, swarmMembers, leadSessionId, activeShift, officeId, tasks,
  outputPreviews, lastActivityAt,
  onFocusSession, onSetRole, onRestartSession, onCloseSession,
}: AgentDashboardProps) {
  const sessionList = Array.from(sessions.entries());
  const [structuredStatus, setStructuredStatus] = useState<Map<string, AgentStructuredStatus>>(new Map());

  const fetchDashboard = useCallback(async () => {
    if (!officeId) {
      setStructuredStatus(new Map());
      return;
    }

    try {
      const res = await fetch(`/api/swarm/dashboard?officeId=${encodeURIComponent(officeId)}`);
      if (!res.ok) return;
      const data = await res.json();
      const map = new Map<string, AgentStructuredStatus>();
      for (const agent of data.agents) {
        map.set(agent.sessionId, agent);
      }
      setStructuredStatus(map);
    } catch {
      // silently ignore fetch errors
    }
  }, [officeId]);

  useEffect(() => {
    if (!officeId || sessionList.length === 0) {
      setStructuredStatus(new Map());
      return;
    }
    fetchDashboard();
    const timer = setInterval(fetchDashboard, 5000);
    return () => clearInterval(timer);
  }, [fetchDashboard, officeId, sessionList.length]);

  const tasksByAgent = useMemo(() => {
    const map = new Map<string, TaskItem[]>();
    for (const task of tasks) {
      if (task.assignedTo) {
        const existing = map.get(task.assignedTo) || [];
        existing.push(task);
        map.set(task.assignedTo, existing);
      }
    }
    return map;
  }, [tasks]);

  const slotBySession = useMemo(() => {
    if (!activeShift) return new Map<string, ShiftSlotState>();
    const map = new Map<string, ShiftSlotState>();
    for (const slot of activeShift.slots) {
      if (slot.sessionId) map.set(slot.sessionId, slot);
    }
    return map;
  }, [activeShift]);

  return (
    <div className="agent-dashboard">
      <div className="agent-dashboard-header">
        <h2>Team Dashboard</h2>
        <span className="agent-dashboard-count">
          {sessionList.length} agent{sessionList.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="agent-dashboard-grid">
        {sessionList.map(([sessionId, session]) => {
          const member = swarmMembers.find(m => m.sessionId === sessionId);
          const slot = slotBySession.get(sessionId);
          const agentTasks = session.agentName
            ? tasksByAgent.get(session.agentName) || []
            : [];
          const previewLines = outputPreviews.get(sessionId) || [];
          const lastActive = lastActivityAt.get(sessionId) || 0;
          const agentStatus = structuredStatus.get(sessionId);

          return (
            <AgentCard
              key={sessionId}
              sessionId={sessionId}
              session={session}
              member={member}
              slotStatus={slot?.status}
              tasks={agentTasks}
              previewLines={previewLines}
              lastActiveAt={lastActive}
              isLead={sessionId === leadSessionId}
              structuredStatus={agentStatus}
              onFocus={() => onFocusSession(sessionId)}
              onSetRole={onSetRole}
              onRestart={() => onRestartSession(sessionId)}
              onClose={() => onCloseSession(sessionId)}
            />
          );
        })}
      </div>
    </div>
  );
}
