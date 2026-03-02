import { useState } from 'react';
import type { SavedSessionSummary } from '../types';
import { FUNCTIONAL_ROLE_COLORS, FUNCTIONAL_ROLE_LABELS } from '../types';

interface Props {
  sessions: SavedSessionSummary[];
  savedAt: string;
  projectPath: string;
  onRestore: (sessionIds: string[]) => void;
  onStartFresh: () => void;
  loading: boolean;
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function cliLabel(cliType: string): string {
  const map: Record<string, string> = {
    claude: 'Claude', gemini: 'Gemini', codex: 'Codex',
    bash: 'Bash', opencode: 'OpenCode',
  };
  return map[cliType] || cliType;
}

export default function SessionPicker({ sessions, savedAt, projectPath, onRestore, onStartFresh, loading }: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(sessions.map(s => s.id)));

  const toggleSession = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(sessions.map(s => s.id)));
  const selectNone = () => setSelected(new Set());

  return (
    <div className="session-picker">
      <div className="session-picker-header">
        <h2>Resume Previous Session?</h2>
        <p className="session-picker-subtitle">
          {sessions.length} saved session{sessions.length !== 1 ? 's' : ''} from {timeAgo(savedAt)}
          {projectPath && <span className="session-picker-project"> — {projectPath}</span>}
        </p>
      </div>

      <div className="session-picker-controls">
        <button className="text-btn" onClick={selectAll} disabled={loading}>Select All</button>
        <button className="text-btn" onClick={selectNone} disabled={loading}>Select None</button>
      </div>

      <div className="session-picker-list">
        {sessions.map(session => (
          <label
            key={session.id}
            className={`session-picker-card ${selected.has(session.id) ? 'selected' : ''}`}
          >
            <input
              type="checkbox"
              checked={selected.has(session.id)}
              onChange={() => toggleSession(session.id)}
              disabled={loading}
            />
            <div className="session-picker-card-body">
              <div className="session-picker-card-top">
                <span className="tile-cli-badge">{cliLabel(session.cliType)}</span>
                <span className="session-picker-agent-name">
                  {session.agentName || 'Anonymous'}
                </span>
                {session.swarmRole === 'lead' && (
                  <span className="session-picker-role-badge lead">Lead</span>
                )}
                {session.functionalRole && (
                  <span
                    className="mosaic-role-badge"
                    style={{
                      backgroundColor: FUNCTIONAL_ROLE_COLORS[session.functionalRole] + '22',
                      color: FUNCTIONAL_ROLE_COLORS[session.functionalRole],
                      border: `1px solid ${FUNCTIONAL_ROLE_COLORS[session.functionalRole]}44`,
                    }}
                  >
                    {FUNCTIONAL_ROLE_LABELS[session.functionalRole]}
                  </span>
                )}
                <span className="session-picker-time">{timeAgo(session.createdAt)}</span>
              </div>
              {session.projectPath && (
                <div className="session-picker-path">{session.projectPath}</div>
              )}
              {session.lastActivity && (
                <div className="session-picker-activity">{session.lastActivity}</div>
              )}
            </div>
          </label>
        ))}
      </div>

      <div className="session-picker-actions">
        <button
          className="secondary-btn"
          onClick={onStartFresh}
          disabled={loading}
        >
          Start Fresh
        </button>
        <button
          className="primary-btn"
          onClick={() => onRestore(Array.from(selected))}
          disabled={selected.size === 0 || loading}
        >
          {loading ? 'Restoring...' : `Resume ${selected.size} Session${selected.size !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
}
