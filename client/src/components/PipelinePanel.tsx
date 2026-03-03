import { useState } from 'react';
import type { TaskItem, PipelineStage, FunctionalRole } from '../types';

interface Props {
  tasks: TaskItem[];
  stages: PipelineStage[];
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

export default function PipelinePanel({ tasks, stages, onMoveTask }: Props) {
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [hideDone, setHideDone] = useState(true);

  const effectiveStages = stages.length > 0
    ? stages
    : deriveStagesFromTasks(tasks);

  const handleMove = (taskId: string, updates: { stage?: string; status?: string }) => {
    if (!onMoveTask) return;
    onMoveTask(taskId, updates);
    setExpandedTaskId(null);
  };

  const activeTaskCount = tasks.filter(t => t.status !== 'done').length;
  const doneTaskCount = tasks.filter(t => t.status === 'done').length;

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
      <div className="pipeline-columns">
        {effectiveStages.map((stage, stageIndex) => {
          const stageTasks = tasks.filter(t => t.stage === stage.name);
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
                        {task.dependsOn && task.dependsOn.length > 0 && task.status === 'open' && (
                          <span className="pipeline-card-deps" title={`Blocked by ${task.dependsOn.length} task(s)`}>
                            &#128274;
                          </span>
                        )}
                      </div>
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
