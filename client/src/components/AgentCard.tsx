import { useState, useEffect } from 'react';
import type { TerminalSession, SwarmMember, ShiftSlotStatus, TaskItem, SwarmRole, AgentStructuredStatus } from '../types';
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
  structuredStatus?: AgentStructuredStatus;
  onFocus: () => void;
  onSetRole: (sessionId: string, role: SwarmRole) => void;
  onRestart: () => void;
  onClose: () => void;
}

export default function AgentCard({
  sessionId, session, slotStatus, tasks,
  previewLines, lastActiveAt, isLead, structuredStatus,
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

  const completedCount = structuredStatus?.completedTasks ?? 0;
  const failedCount = structuredStatus?.failedTasks ?? 0;
  const lastAction = structuredStatus?.lastAction;
  const recentFiles = structuredStatus?.recentFiles ?? [];
  const circuitOpen = structuredStatus?.circuitState === 'open';
  const compactionCount = Math.max(structuredStatus?.compactionCount ?? 0, session.compactionCount ?? 0);

  return (
    <div className="agent-card" onClick={onFocus}>
      <div className="agent-card-header">
        <span className="agent-card-status-dot" style={{ backgroundColor: circuitOpen ? '#f7768e' : (STATUS_COLORS[status] || '#565f89') }} />
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
        {circuitOpen && (
          <span className="agent-card-circuit-badge">CIRCUIT OPEN</span>
        )}
        <span className="agent-card-compaction" title={`Compactions: ${compactionCount}`}>
          C{compactionCount}
        </span>
        <span className="agent-card-idle">{idleStr}</span>
      </div>

      {session.worktreeBranch && (
        <div className="agent-card-branch">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="#565f89" style={{ marginRight: 4, flexShrink: 0 }}>
            <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6a2.5 2.5 0 0 1-2.5 2.5H7.5a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.492 2.492 0 0 1 7.5 7h2.5a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM4.25 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z"/>
          </svg>
          <span>{session.worktreeBranch}</span>
        </div>
      )}

      {currentTask ? (
        <div className="agent-card-task">
          <span className="agent-card-task-dot" style={{ backgroundColor: TASK_STATUS_COLORS[currentTask.status] || '#565f89' }} />
          <span className="agent-card-task-title">{currentTask.title}</span>
          {structuredStatus?.taskElapsedSeconds != null && structuredStatus.taskElapsedSeconds > 0 && (
            <span className="agent-card-task-elapsed">
              {formatElapsed(structuredStatus.taskElapsedSeconds)}
            </span>
          )}
        </div>
      ) : (
        <div className="agent-card-task agent-card-task-empty">No active task</div>
      )}

      {(completedCount > 0 || failedCount > 0) && (
        <div className="agent-card-stats">
          {completedCount > 0 && <span className="agent-card-stat-done">{completedCount} done</span>}
          {failedCount > 0 && <span className="agent-card-stat-failed">{failedCount} blocked</span>}
        </div>
      )}

      {structuredStatus && structuredStatus.totalCost > 0 && (
        <div className="agent-card-cost">
          <span className="agent-card-cost-amount">
            ${structuredStatus.totalCost.toFixed(2)}
          </span>
          {structuredStatus.budgetCents != null && structuredStatus.budgetPercent != null && (
            <>
              <div className="agent-card-budget-bar">
                <div
                  className="agent-card-budget-fill"
                  style={{
                    width: `${Math.min(100, structuredStatus.budgetPercent)}%`,
                    backgroundColor: structuredStatus.budgetPercent >= 100 ? '#f7768e'
                      : structuredStatus.budgetPercent >= 95 ? '#ff9e64'
                      : structuredStatus.budgetPercent >= 80 ? '#e0af68'
                      : '#9ece6a',
                  }}
                />
              </div>
              <span className="agent-card-budget-label">
                {Math.round(structuredStatus.budgetPercent)}% of ${(structuredStatus.budgetCents / 100).toFixed(2)}
              </span>
            </>
          )}
        </div>
      )}

      {lastAction ? (
        <div className="agent-card-last-action">{lastAction}</div>
      ) : null}

      {recentFiles.length > 0 && (
        <div className="agent-card-files">
          {recentFiles.map((f, i) => (
            <span key={i} className="agent-card-file-badge">{f.split('/').pop()}</span>
          ))}
        </div>
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

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`;
}
