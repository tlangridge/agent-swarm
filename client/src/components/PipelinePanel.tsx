import { useState } from 'react';
import type { TaskItem, PipelineStage, FunctionalRole } from '../types';

interface Props {
  tasks: TaskItem[];
  stages: PipelineStage[];
  officeId?: string | null;
  onMoveTask?: (taskId: string, updates: { stage?: string; status?: string }) => Promise<void>;
}

const STATUS_COLORS: Record<string, string> = {
  'open': '#7aa2f7',
  'in-progress': '#ff9e64',
  'blocked': '#f7768e',
  'done': '#9ece6a',
};

const STATUS_LABELS: Record<string, string> = {
  'open': 'Open',
  'in-progress': 'In Progress',
  'blocked': 'Blocked',
  'done': 'Done',
};

const PRIORITY_COLORS: Record<string, string> = {
  'urgent': '#f7768e',
  'high': '#ff9e64',
  'medium': '#e0af68',
  'low': '#565f89',
};

const PRIORITY_LABELS: Record<string, string> = {
  'urgent': '!!!',
  'high': '!!',
  'medium': '!',
  'low': '',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '--';
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low'];

function sortByPriority(tasks: TaskItem[]): TaskItem[] {
  return [...tasks].sort((a, b) => {
    const ai = a.priority ? PRIORITY_ORDER.indexOf(a.priority) : 99;
    const bi = b.priority ? PRIORITY_ORDER.indexOf(b.priority) : 99;
    return ai - bi;
  });
}

interface RenderStage extends PipelineStage {
  source: 'configured' | 'derived';
}

export default function PipelinePanel({ tasks, stages, officeId, onMoveTask }: Props) {
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [hideDone, setHideDone] = useState(true);
  const taskById = new Map(tasks.map(task => [task.id, task]));
  const configuredStageLookup = new Map(stages.map(stage => [stage.name.trim().toLowerCase(), stage]));
  const orphanedTasks = stages.length > 0
    ? tasks.filter(task => !configuredStageLookup.has(task.stage.trim().toLowerCase()))
    : [];
  const orphanedStageNames = [...new Set(orphanedTasks.map(task => task.stage))].sort((a, b) => a.localeCompare(b));

  const effectiveStages: RenderStage[] = stages.length > 0
    ? stages.map(stage => ({ ...stage, source: 'configured' as const }))
    : deriveStagesFromTasks(tasks).map(stage => ({ ...stage, source: 'derived' as const }));

  const handleMove = (taskId: string, updates: { stage?: string; status?: string }) => {
    if (!onMoveTask) return;
    onMoveTask(taskId, updates);
    setExpandedTaskId(null);
  };

  const activeTaskCount = tasks.filter(t => t.status !== 'done').length;
  const doneTaskCount = tasks.filter(t => t.status === 'done').length;
  const allVisibleTasksHiddenByDone = hideDone && activeTaskCount === 0 && doneTaskCount > 0;

  return (
    <div className="pipeline-panel">
      <div className="pipeline-header">
        <h3>Pipeline</h3>
        <div className="pipeline-header-right">
          {doneTaskCount > 0 && (
            <button
              className={`pipeline-hide-done-btn ${hideDone ? 'active' : ''}`}
              onClick={() => setHideDone(v => !v)}
              title={hideDone ? 'Show done tasks' : 'Hide done tasks'}
            >
              {hideDone ? `${doneTaskCount} hidden` : `${doneTaskCount} done`}
            </button>
          )}
          <span className="pipeline-task-count">{activeTaskCount} active</span>
        </div>
      </div>
      {allVisibleTasksHiddenByDone && (
        <div className="pipeline-board-notice">
          <div>
            All tasks in this office are currently marked done, so the board looks empty while the done filter is on.
          </div>
          <button
            className="pipeline-notice-btn"
            onClick={() => setHideDone(false)}
          >
            Show {doneTaskCount} done task{doneTaskCount === 1 ? '' : 's'}
          </button>
        </div>
      )}
      {orphanedTasks.length > 0 && (
        <div className="pipeline-orphan-panel">
          <div className="pipeline-orphan-header">
            <span className="pipeline-orphan-title">Tasks outside configured pipeline</span>
            <span className="pipeline-orphan-count">
              {orphanedTasks.length} task{orphanedTasks.length === 1 ? '' : 's'} in {orphanedStageNames.length} invalid stage{orphanedStageNames.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="pipeline-orphan-copy">
            These tasks are stored with stage names that do not exist in this office&apos;s configured pipeline. They are visible here for cleanup but are not rendered as kanban columns.
          </div>
          <div className="pipeline-orphan-stage-list">
            {orphanedStageNames.map(stageName => {
              const stageTasks = orphanedTasks.filter(task => task.stage === stageName);
              return (
                <div key={stageName} className="pipeline-orphan-stage">
                  <div className="pipeline-orphan-stage-name">{stageName}</div>
                  <div className="pipeline-orphan-task-list">
                    {stageTasks.map(task => (
                      <div key={task.id} className="pipeline-orphan-task">
                        <span className={`pipeline-orphan-status status-${task.status}`}>{STATUS_LABELS[task.status] || task.status}</span>
                        <span className="pipeline-orphan-task-title">{task.title}</span>
                        <span className="pipeline-orphan-task-id">{task.id}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="pipeline-columns">
        {effectiveStages.map((stage, stageIndex) => {
          const stageTasks = tasks.filter(t => t.stage.trim().toLowerCase() === stage.name.trim().toLowerCase());
          const activeTasks = sortByPriority(stageTasks.filter(t => t.status !== 'done'));
          const doneTasks = hideDone ? [] : sortByPriority(stageTasks.filter(t => t.status === 'done'));
          const visibleTasks = [...activeTasks, ...doneTasks];
          const totalDoneInStage = stageTasks.filter(t => t.status === 'done').length;

          return (
            <div key={stage.name} className="pipeline-column">
              <div className="pipeline-column-header">
                <span className="pipeline-stage-name">{stage.name}</span>
                <span className="pipeline-stage-count">
                  {activeTasks.length}
                  {totalDoneInStage > 0 && !hideDone && (
                    <span className="pipeline-done-count">+{totalDoneInStage}</span>
                  )}
                </span>
              </div>
              <div className="pipeline-column-body">
                {visibleTasks.map(task => {
                  const isDone = task.status === 'done';
                  const isExpanded = expandedTaskId === task.id;
                  const unmetDependencyCount = (task.dependsOn || []).filter(depId => taskById.get(depId)?.status !== 'done').length;

                  return (
                    <div
                      key={task.id}
                      className={`pipeline-card ${isExpanded ? 'expanded' : ''} ${isDone ? 'done' : ''}`}
                      onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                    >
                      <div className="pipeline-card-status">
                        <span
                          className="pipeline-status-dot"
                          style={{ backgroundColor: STATUS_COLORS[task.status] || '#565f89' }}
                        />
                        {task.priority && task.priority !== 'low' && (
                          <span
                            className="pipeline-card-priority"
                            style={{ color: PRIORITY_COLORS[task.priority] }}
                            title={task.priority}
                          >
                            {PRIORITY_LABELS[task.priority]}
                          </span>
                        )}
                        <span className="pipeline-card-title">{task.title}</span>
                        {unmetDependencyCount > 0 && task.status === 'open' && (
                          <span className="pipeline-card-deps" title={`Waiting on ${unmetDependencyCount} ${unmetDependencyCount === 1 ? 'dependency' : 'dependencies'}`}>
                            &#128274;
                          </span>
                        )}
                      </div>
                      {task.checkoutSessionId && (
                        <div className={`pipeline-card-checkout ${task.checkoutStale ? 'pipeline-checkout-stale' : ''} ${task.checkoutLive === false ? 'pipeline-checkout-dead' : ''}`}>
                          <span className="pipeline-checkout-lock">&#128274;</span>
                          <span className="pipeline-checkout-agent">{task.checkoutAgentName}</span>
                          {task.checkoutStale && <span className="pipeline-checkout-badge stale">STALE</span>}
                          {task.checkoutLive === false && <span className="pipeline-checkout-badge dead">DEAD</span>}
                          {(task.checkoutStale || task.checkoutLive === false) && (
                            <button
                              className="pipeline-release-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                const query = officeId ? `?officeId=${encodeURIComponent(officeId)}` : '';
                                fetch(`/api/swarm/tasks/${task.id}/release${query}`, {
                                  method: 'POST',
                                  headers: { 'X-Dashboard': 'true' },
                                });
                              }}
                            >
                              &#128275; Release
                            </button>
                          )}
                        </div>
                      )}
                      <div className="pipeline-card-meta">
                        {task.branch && (
                          <span className="pipeline-card-branch" title={`Branch: ${task.branch}`}>
                            &#9585; {task.branch}
                          </span>
                        )}
                        {task.tags && task.tags.length > 0 && (
                          <div className="pipeline-card-tags">
                            {task.tags.slice(0, 3).map((tag, i) => (
                              <span key={i} className="pipeline-card-tag">{tag}</span>
                            ))}
                          </div>
                        )}
                        {task.assignedTo && (
                          <span className="pipeline-card-assignee">{task.assignedTo}</span>
                        )}
                      </div>

                      {/* Expanded detail view */}
                      {isExpanded && (
                        <div className="pipeline-card-detail" onClick={e => e.stopPropagation()}>
                          <div className="pipeline-detail-row">
                            <span className="pipeline-detail-label">Status</span>
                            <span className="pipeline-detail-value" style={{ color: STATUS_COLORS[task.status] }}>
                              {STATUS_LABELS[task.status] || task.status}
                            </span>
                          </div>
                          {task.priority && (
                            <div className="pipeline-detail-row">
                              <span className="pipeline-detail-label">Priority</span>
                              <span className="pipeline-detail-value" style={{ color: PRIORITY_COLORS[task.priority] }}>
                                {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
                              </span>
                            </div>
                          )}
                          {task.assignedTo && (
                            <div className="pipeline-detail-row">
                              <span className="pipeline-detail-label">Assigned</span>
                              <span className="pipeline-detail-value">{task.assignedTo}</span>
                            </div>
                          )}
                          {task.description && (
                            <div className="pipeline-detail-block">
                              <span className="pipeline-detail-label">Description</span>
                              <p className="pipeline-detail-text">{task.description}</p>
                            </div>
                          )}
                          {task.context && (
                            <div className="pipeline-detail-block">
                              <span className="pipeline-detail-label">Context</span>
                              <p className="pipeline-detail-text">{task.context}</p>
                            </div>
                          )}
                          {task.tags && task.tags.length > 0 && (
                            <div className="pipeline-detail-row">
                              <span className="pipeline-detail-label">Tags</span>
                              <div className="pipeline-card-tags">
                                {task.tags.map((tag, i) => (
                                  <span key={i} className="pipeline-card-tag">{tag}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="pipeline-detail-row">
                            <span className="pipeline-detail-label">Created</span>
                            <span className="pipeline-detail-value">{timeAgo(task.createdAt)} by {task.createdBy}</span>
                          </div>
                          {task.updatedAt !== task.createdAt && (
                            <div className="pipeline-detail-row">
                              <span className="pipeline-detail-label">Updated</span>
                              <span className="pipeline-detail-value">{timeAgo(task.updatedAt)}</span>
                            </div>
                          )}
                          {task.dependsOn && task.dependsOn.length > 0 && (
                            <div className="pipeline-detail-block">
                              <span className="pipeline-detail-label">Depends on</span>
                              <div className="pipeline-deps-list">
                                {task.dependsOn.map(depId => {
                                  const depTask = tasks.find(t => t.id === depId);
                                  return (
                                    <span key={depId} className="pipeline-dep-chip" style={{
                                      borderColor: depTask?.status === 'done' ? '#9ece6a' : '#f7768e',
                                    }}>
                                      <span className="pipeline-status-dot" style={{
                                        backgroundColor: depTask?.status === 'done' ? '#9ece6a' : '#f7768e',
                                        width: 6, height: 6,
                                      }} />
                                      {depTask?.title || depId}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {task.output && (
                            <div className="pipeline-detail-block">
                              <span className="pipeline-detail-label">Output</span>
                              <p className="pipeline-detail-text">{task.output}</p>
                            </div>
                          )}
                          {task.branch && (
                            <div className="pipeline-detail-row">
                              <span className="pipeline-detail-label">Branch</span>
                              <span className="pipeline-detail-value pipeline-detail-branch">&#9585; {task.branch}</span>
                            </div>
                          )}
                          {task.prUrl && (
                            <div className="pipeline-detail-row">
                              <span className="pipeline-detail-label">PR</span>
                              <a
                                className="pipeline-detail-link"
                                href={task.prUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                              >
                                #{task.prNumber} &#8599;
                              </a>
                            </div>
                          )}
                          {task.issueUrl && (
                            <div className="pipeline-detail-row">
                              <span className="pipeline-detail-label">Issue</span>
                              <a
                                className="pipeline-detail-link"
                                href={task.issueUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                              >
                                #{task.issueNumber} &#8599;
                              </a>
                            </div>
                          )}

                          {/* Stage movement + done actions */}
                          {onMoveTask && (
                            <div className="pipeline-card-actions">
                              {stageIndex > 0 && (
                                <button
                                  className="pipeline-move-btn"
                                  onClick={() => handleMove(task.id, { stage: effectiveStages[stageIndex - 1].name })}
                                >
                                  &#9664; {effectiveStages[stageIndex - 1].name}
                                </button>
                              )}
                              {stageIndex < effectiveStages.length - 1 && (
                                <button
                                  className="pipeline-move-btn pipeline-move-forward"
                                  onClick={() => {
                                    const nextIsLast = stageIndex + 1 === effectiveStages.length - 1;
                                    const updates: { stage: string; status?: string } = {
                                      stage: effectiveStages[stageIndex + 1].name,
                                    };
                                    if (nextIsLast) updates.status = 'done';
                                    handleMove(task.id, updates);
                                  }}
                                >
                                  {effectiveStages[stageIndex + 1].name} &#9654;
                                </button>
                              )}
                              {task.status !== 'done' ? (
                                <button
                                  className="pipeline-move-btn pipeline-done-btn"
                                  onClick={() => handleMove(task.id, { status: 'done' })}
                                >
                                  &#10003; Done
                                </button>
                              ) : (
                                <button
                                  className="pipeline-move-btn pipeline-reopen-btn"
                                  onClick={() => handleMove(task.id, { status: 'open' })}
                                >
                                  &#8634; Reopen
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {visibleTasks.length === 0 && (
                  <div className="pipeline-card-empty">No tasks</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function deriveStagesFromTasks(tasks: TaskItem[]): PipelineStage[] {
  const stageNames = [...new Set(tasks.map(t => t.stage))];
  return stageNames.map(name => ({
    name,
    description: '',
    assignedRoles: [] as FunctionalRole[],
  }));
}
