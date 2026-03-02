import { useState, useEffect } from 'react';
import type { TerminalSession, SwarmMember, ShiftSlotStatus, TaskItem, SwarmRole } from '../types';
import { FUNCTIONAL_ROLE_COLORS, FUNCTIONAL_ROLE_LABELS } from '../types';

const STATUS_COLORS: Record<string, string> = {
  active: '#9ece6a',
  booting: '#ff9e64',
  pending: '#565f89',
  failed: '#f7768e',
  idle: '#565f89',
  ended: '#565f89',
};

const TASK_STATUS_COLORS: Record<string, string> = {
  'open': '#7aa2f7',
  'in-progress': '#ff9e64',
  'blocked': '#f7768e',
  'done': '#9ece6a',
};

interface AgentCardProps {
  sessionId: string;
  session: TerminalSession;
  member?: SwarmMember;
  slotStatus?: ShiftSlotStatus;
  tasks: TaskItem[];
  previewLines: string[];
  lastActiveAt: number;
  isLead: boolean;
  onFocus: () => void;
  onSetRole: (sessionId: string, role: SwarmRole) => void;
  onRestart: () => void;
  onClose: () => void;
}

export default function AgentCard({
  sessionId, session, slotStatus, tasks,
  previewLines, lastActiveAt, isLead,
  onFocus, onSetRole, onRestart, onClose,
}: AgentCardProps) {
  const [idleStr, setIdleStr] = useState('');

  useEffect(() => {
    function update() {
      if (!lastActiveAt) { setIdleStr('--'); return; }
      const seconds = Math.floor((Date.now() - lastActiveAt) / 1000);
      if (seconds < 30) setIdleStr('Active');
      else if (seconds < 60) setIdleStr(`${seconds}s`);
      else if (seconds < 3600) setIdleStr(`${Math.floor(seconds / 60)}m`);
      else setIdleStr(`${Math.floor(seconds / 3600)}h`);
    }
    update();
    const timer = setInterval(update, 10_000);
    return () => clearInterval(timer);
  }, [lastActiveAt]);

  const status = slotStatus || (lastActiveAt && Date.now() - lastActiveAt < 30_000 ? 'active' : 'idle');
  const currentTask = tasks.find(t => t.status === 'in-progress') || tasks.find(t => t.status === 'open');
  const fr = session.functionalRole;

  return (
    <div className="agent-card" onClick={onFocus}>
      <div className="agent-card-header">
        <span className="agent-card-status-dot" style={{ backgroundColor: STATUS_COLORS[status] || '#565f89' }} />
        <span className="agent-card-name">{session.agentName || session.cliType}</span>
        {isLead && (
          <svg className="agent-card-lead-icon" width="12" height="12" viewBox="0 0 16 16" fill="#e0af68">
            <path d="M2 13.5V15h12v-1.5H2zm.5-2.5h11l-1.5-5-3 2L8 4.5 6.5 8l-3-2L2 11.5z"/>
          </svg>
        )}
        {fr && (
          <span
            className="agent-card-role-badge"
            style={{
              backgroundColor: FUNCTIONAL_ROLE_COLORS[fr] + '22',
              color: FUNCTIONAL_ROLE_COLORS[fr],
              border: `1px solid ${FUNCTIONAL_ROLE_COLORS[fr]}44`,
            }}
          >
            {FUNCTIONAL_ROLE_LABELS[fr]}
          </span>
        )}
        <span className="agent-card-idle">{idleStr}</span>
      </div>

      {currentTask ? (
        <div className="agent-card-task">
          <span className="agent-card-task-dot" style={{ backgroundColor: TASK_STATUS_COLORS[currentTask.status] || '#565f89' }} />
          <span className="agent-card-task-title">{currentTask.title}</span>
        </div>
      ) : (
        <div className="agent-card-task agent-card-task-empty">No active task</div>
      )}

      <div className="agent-card-preview">
        {previewLines.length > 0
          ? previewLines.map((line, i) => <div key={i}>{line}</div>)
          : <span className="agent-card-preview-empty">Waiting for output...</span>
        }
      </div>

      <div className="agent-card-actions" onClick={e => e.stopPropagation()}>
        <button
          onClick={() => onSetRole(sessionId, isLead ? 'worker' : 'lead')}
          title={isLead ? 'Demote to worker' : 'Promote to lead'}
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 13.5V15h12v-1.5H2zm.5-2.5h11l-1.5-5-3 2L8 4.5 6.5 8l-3-2L2 11.5z"/>
          </svg>
        </button>
        <button onClick={onRestart} title="Restart">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 0 0-7 7h2a5 5 0 0 1 9.17-2.74L10 7h5V2l-1.94 1.94A7 7 0 0 0 8 1zm5 7a5 5 0 0 1-9.17 2.74L6 9H1v5l1.94-1.94A7 7 0 0 0 15 8h-2z"/>
          </svg>
        </button>
        <button onClick={onClose} title="Close">
          &times;
        </button>
      </div>
    </div>
  );
}
