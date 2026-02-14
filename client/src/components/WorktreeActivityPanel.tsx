import { useMemo, useState } from 'react';
import type { WorktreeChangeStatus, WorktreeOverviewAgent, WorktreeOverviewResponse } from '../types';

interface WorktreeActivityPanelProps {
  projectPath: string;
  overview: WorktreeOverviewResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

function statusClass(status: WorktreeChangeStatus): string {
  if (status === '??') return 'status-untracked';
  if (status === 'M') return 'status-modified';
  if (status === 'A') return 'status-added';
  if (status === 'D') return 'status-deleted';
  if (status === 'R') return 'status-renamed';
  return 'status-conflicted';
}

function shortName(agent: WorktreeOverviewAgent): string {
  const name = agent.agentName || 'Anonymous';
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || '')
    .join('');
  return initials || 'A';
}

export default function WorktreeActivityPanel({
  projectPath,
  overview,
  loading,
  error,
  onRefresh,
}: WorktreeActivityPanelProps) {
  const [expandedByPath, setExpandedByPath] = useState<Record<string, boolean>>({});
  const updatedAt = useMemo(() => {
    if (!overview?.generatedAt) return null;
    const parsed = new Date(overview.generatedAt);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleTimeString();
  }, [overview?.generatedAt]);

  const toggleExpanded = (path: string, defaultExpanded: boolean) => {
    setExpandedByPath(prev => ({ ...prev, [path]: !(prev[path] ?? defaultExpanded) }));
  };

  const hasAnyChanges = overview?.worktrees.some(worktree => worktree.totals.changed > 0) ?? false;

  return (
    <aside className="worktree-panel">
      <div className="worktree-panel-header">
        <div>
          <h3>Worktree Activity</h3>
          <p>{updatedAt ? `Updated ${updatedAt}` : 'Waiting for data...'}</p>
        </div>
        <button className="worktree-refresh-btn" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      <div className="worktree-panel-body">
        {loading && (
          <div className="worktree-empty-state">Loading worktree overview...</div>
        )}

        {!loading && error && (
          <div className="worktree-error-state">
            <p>{error}</p>
            <button className="secondary-btn" onClick={onRefresh}>Retry</button>
          </div>
        )}

        {!loading && !error && !projectPath && (
          <div className="worktree-empty-state">Set a project path to view worktree activity.</div>
        )}

        {!loading && !error && projectPath && overview && !overview.isGitRepo && (
          <div className="worktree-empty-state">Project path is not a git repository.</div>
        )}

        {!loading && !error && overview?.isGitRepo && overview.worktrees.length === 0 && (
          <div className="worktree-empty-state">No worktrees found.</div>
        )}

        {!loading && !error && overview?.isGitRepo && !hasAnyChanges && (
          <div className="worktree-empty-state">No changed files detected.</div>
        )}

        {!loading && !error && overview?.isGitRepo && overview.worktrees.map(worktree => {
          const defaultExpanded = worktree.activeAgents.length > 0;
          const expanded = expandedByPath[worktree.path] ?? defaultExpanded;

          return (
            <div key={worktree.path} className="worktree-card">
              <button
                className="worktree-card-header"
                onClick={() => toggleExpanded(worktree.path, defaultExpanded)}
                title={worktree.path}
              >
                <div className="worktree-title-row">
                  <span className="worktree-branch">{worktree.branch}</span>
                  {worktree.isMain && <span className="worktree-main-badge">main</span>}
                </div>
                <div className="worktree-meta-row">
                  <span>{worktree.totals.changed} changed</span>
                  <span>{expanded ? '▾' : '▸'}</span>
                </div>
              </button>

              <div className="worktree-card-path">{worktree.path}</div>

              <div className="worktree-agent-row">
                {worktree.activeAgents.length === 0 ? (
                  <span className="worktree-muted-text">No active agents</span>
                ) : (
                  worktree.activeAgents.map(agent => (
                    <span
                      key={agent.sessionId}
                      className={`worktree-agent-badge ${agent.role === 'lead' ? 'lead' : ''}`}
                      title={`${agent.agentName || 'Anonymous'} (${agent.role})`}
                    >
                      {shortName(agent)}
                    </span>
                  ))
                )}
              </div>

              {worktree.error && (
                <div className="worktree-card-error">{worktree.error}</div>
              )}

              {expanded && !worktree.error && (
                <div className="worktree-file-list">
                  {worktree.changes.length === 0 ? (
                    <div className="worktree-muted-text">No changes</div>
                  ) : (
                    worktree.changes.map(change => (
                      <div className="worktree-file-row" key={`${change.status}:${change.path}:${change.oldPath || ''}`}>
                        <span className={`worktree-file-status ${statusClass(change.status)}`}>{change.status}</span>
                        <span className="worktree-file-path" title={change.path}>{change.path}</span>
                        {worktree.activeAgents.length > 0 && (
                          <div className="worktree-file-agents">
                            {worktree.activeAgents.slice(0, 3).map(agent => (
                              <span
                                key={`${change.path}-${agent.sessionId}`}
                                className={`worktree-file-agent-dot ${agent.role === 'lead' ? 'lead' : ''}`}
                                title={`${agent.agentName || 'Anonymous'} (${agent.role})`}
                              />
                            ))}
                            {worktree.activeAgents.length > 3 && (
                              <span className="worktree-file-agent-more">+{worktree.activeAgents.length - 3}</span>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                  {worktree.truncated && (
                    <div className="worktree-truncated">
                      Showing first {worktree.changes.length} of {worktree.totalDetected} files
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
