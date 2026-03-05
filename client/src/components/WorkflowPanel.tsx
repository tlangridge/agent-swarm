import { useState, useEffect, useCallback } from 'react';
import type { CronJob, ShiftState } from '../types';
import { FUNCTIONAL_ROLE_LABELS } from '../types';

interface SchedulerJob {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  intervalMs: number;
}

interface SchedulerStatus {
  running: boolean;
  jobs: SchedulerJob[];
}

interface WorkspaceFile {
  path: string;
  description?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  sizeBytes: number;
}

interface WorkspaceIndex {
  files: WorkspaceFile[];
  updatedAt: string;
}

interface Props {
  activeShift: ShiftState | null;
}

function timeLabel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '--';
  const abs = Math.abs(diff);
  const prefix = diff < 0 ? 'in ' : '';
  const suffix = diff >= 0 ? ' ago' : '';
  if (abs < 60_000) return diff < 0 ? 'in <1m' : 'just now';
  if (abs < 3_600_000) return `${prefix}${Math.floor(abs / 60_000)}m${suffix}`;
  if (abs < 86_400_000) return `${prefix}${Math.floor(abs / 3_600_000)}h${suffix}`;
  return `${prefix}${Math.floor(abs / 86_400_000)}d${suffix}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function WorkflowPanel({ activeShift }: Props) {
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  const isActive = activeShift && activeShift.status !== 'ended';

  const officeId = activeShift?.officeId;

  const fetchCrons = useCallback(async () => {
    if (!officeId) return;
    try {
      const res = await fetch(`/api/swarm/crons?officeId=${encodeURIComponent(officeId)}`);
      if (!res.ok) return;
      const data = await res.json();
      setCronJobs(data.cronJobs || []);
      setScheduler(data.scheduler || null);
    } catch { /* ignore */ }
  }, [officeId]);

  const fetchFiles = useCallback(async () => {
    if (!officeId) return;
    try {
      const res = await fetch(`/api/swarm/files?officeId=${encodeURIComponent(officeId)}`);
      if (!res.ok) return;
      const data: WorkspaceIndex = await res.json();
      setFiles(data.files || []);
    } catch { /* ignore */ }
  }, [officeId]);

  useEffect(() => {
    if (!isActive) return;
    fetchCrons();
    fetchFiles();
    const timer = setInterval(() => {
      fetchCrons();
      fetchFiles();
    }, 10_000);
    return () => clearInterval(timer);
  }, [isActive, fetchCrons, fetchFiles]);

  const handleFileClick = async (path: string) => {
    if (expandedFile === path) {
      setExpandedFile(null);
      setFileContent(null);
      return;
    }
    setExpandedFile(path);
    setFileContent(null);
    setLoadingFile(true);
    try {
      const encodedPath = path.split('/').map(encodeURIComponent).join('/');
      const res = await fetch(`/api/swarm/files/${encodedPath}`);
      if (res.ok) {
        const data = await res.json();
        setFileContent(data.content ?? '(empty)');
      } else {
        setFileContent('(failed to load)');
      }
    } catch {
      setFileContent('(failed to load)');
    } finally {
      setLoadingFile(false);
    }
  };

  if (!isActive) {
    return (
      <div className="workflow-panel">
        <div className="workflow-empty">
          <p>Start a shift to see workflow status.</p>
          <p style={{ fontSize: 11, color: '#565f89' }}>
            Cron jobs, workspace files, and task activity will appear here during an active shift.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="workflow-panel">
      {/* Cron Jobs Section */}
      <div className="workflow-section">
        <div className="workflow-section-header">
          <span className="workflow-section-title">Scheduled Tasks</span>
          <span className="workflow-section-count">{cronJobs.length}</span>
        </div>
        {cronJobs.length === 0 ? (
          <div className="workflow-section-empty">
            No scheduled tasks. Agents can create them via <code>swarm cron create</code>.
          </div>
        ) : (
          <div className="workflow-cron-list">
            {cronJobs.map(job => {
              const schedulerJob = scheduler?.jobs.find(j => j.id === job.id);
              const target = job.targetAgent
                ? job.targetAgent
                : job.targetRole
                ? FUNCTIONAL_ROLE_LABELS[job.targetRole]
                : 'All';
              return (
                <div key={job.id} className={`workflow-cron-item ${job.enabled ? '' : 'disabled'}`}>
                  <div className="workflow-cron-top">
                    <span className={`workflow-cron-dot ${job.enabled ? 'active' : 'inactive'}`} />
                    <span className="workflow-cron-name">{job.name || '(unnamed)'}</span>
                    <span className="workflow-cron-schedule">{job.schedule}</span>
                  </div>
                  <div className="workflow-cron-meta">
                    <span className="workflow-cron-target">{target}</span>
                    {job.lastRun && (
                      <span className="workflow-cron-lastrun">Last: {timeLabel(job.lastRun)}</span>
                    )}
                    {schedulerJob?.nextRun && (
                      <span className="workflow-cron-nextrun">Next: {timeLabel(schedulerJob.nextRun)}</span>
                    )}
                  </div>
                  {job.prompt && (
                    <div className="workflow-cron-prompt" title={job.prompt}>
                      {job.prompt.length > 80 ? job.prompt.slice(0, 80) + '...' : job.prompt}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Workspace Files Section */}
      <div className="workflow-section">
        <div className="workflow-section-header">
          <span className="workflow-section-title">Workspace Files</span>
          <span className="workflow-section-count">{files.length}</span>
        </div>
        {files.length === 0 ? (
          <div className="workflow-section-empty">
            No shared files yet. Agents can create them via <code>swarm write &lt;path&gt;</code>.
          </div>
        ) : (
          <div className="workflow-file-list">
            {files.map(file => (
              <div key={file.path} className="workflow-file-item">
                <div
                  className={`workflow-file-row ${expandedFile === file.path ? 'expanded' : ''}`}
                  onClick={() => handleFileClick(file.path)}
                >
                  <svg
                    className="workflow-file-icon"
                    width="12" height="12" viewBox="0 0 16 16" fill="currentColor"
                  >
                    <path d="M3 1h6.586L13 4.414V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm6 0v4h4"/>
                  </svg>
                  <span className="workflow-file-name">{file.path}</span>
                  <span className="workflow-file-size">{formatBytes(file.sizeBytes)}</span>
                </div>
                <div className="workflow-file-meta">
                  <span>by {file.updatedBy}</span>
                  <span>{timeLabel(file.updatedAt)}</span>
                </div>
                {file.description && (
                  <div className="workflow-file-desc">{file.description}</div>
                )}
                {expandedFile === file.path && (
                  <div className="workflow-file-content">
                    {loadingFile ? (
                      <span style={{ color: '#565f89' }}>Loading...</span>
                    ) : (
                      <pre>{fileContent}</pre>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
