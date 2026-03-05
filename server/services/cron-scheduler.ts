import type { CronJob, Office } from './office-store.js';
import type { FunctionalRole } from './swarm-registry.js';
import { getOffice, saveOffice } from './office-store.js';

type ResolveTargetsFn = (job: CronJob, officeId: string) => string[];
type InjectFn = (sessionId: string, message: string) => void;

interface ActiveTimer {
  jobId: string;
  name: string;
  schedule: string;
  enabled: boolean;
  interval: ReturnType<typeof setInterval>;
  nextRun: Date;
  intervalMs: number;
}

interface OfficeScheduler {
  timers: ActiveTimer[];
  running: boolean;
}
const schedulers = new Map<string, OfficeScheduler>();

/**
 * Parse a simple interval schedule string into milliseconds.
 * Supported formats:
 *   "every Nm"  → N minutes
 *   "every Nh"  → N hours
 *   "every Ns"  → N seconds (useful for testing)
 */
function parseSchedule(schedule: string): number | null {
  const match = schedule.match(/^every\s+(\d+)\s*(s|m|h)$/i);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  if (value <= 0) return null;

  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    default: return null;
  }
}

/**
 * Start the cron scheduler for all enabled jobs in the given office.
 * Called during badge-in after all agents are booted.
 */
export function startScheduler(
  office: Office,
  resolveTargets: ResolveTargetsFn,
  injectFn: InjectFn,
): void {
  stopScheduler(office.id);

  const sched: OfficeScheduler = { timers: [], running: true };
  schedulers.set(office.id, sched);

  const jobs = office.cronJobs ?? [];

  for (const job of jobs) {
    if (!job.enabled) continue;

    const intervalMs = parseSchedule(job.schedule);
    if (!intervalMs) {
      console.warn(`cron-scheduler: invalid schedule "${job.schedule}" for job "${job.name}" (${job.id}), skipping`);
      continue;
    }

    const nextRun = new Date(Date.now() + intervalMs);

    const interval = setInterval(async () => {
      const targets = resolveTargets(job, office.id);
      if (targets.length === 0) return;

      const message = `[CRON ${job.name}]: ${job.prompt}`;
      for (const sessionId of targets) {
        injectFn(sessionId, message);
      }

      // Update lastRun on the job and persist
      job.lastRun = new Date().toISOString();

      // Update nextRun on our timer record
      const timer = sched.timers.find(t => t.jobId === job.id);
      if (timer) {
        timer.nextRun = new Date(Date.now() + timer.intervalMs);
      }

      // Persist to disk
      try {
        const freshOffice = await getOffice(office.id);
        if (freshOffice) {
          const cronJob = freshOffice.cronJobs?.find(c => c.id === job.id);
          if (cronJob) {
            cronJob.lastRun = job.lastRun;
            await saveOffice(freshOffice);
          }
        }
      } catch (err) {
        console.error(`cron-scheduler: failed to persist lastRun for job "${job.name}":`, err);
      }
    }, intervalMs);

    sched.timers.push({ jobId: job.id, name: job.name, schedule: job.schedule, enabled: job.enabled, interval, nextRun, intervalMs });
  }

  const enabledCount = sched.timers.length;
  const totalCount = jobs.length;
  console.log(`cron-scheduler: started ${enabledCount} job(s) of ${totalCount} total for office ${office.id}`);
}

/**
 * Stop the scheduler and clear all active intervals.
 * Called during badge-out.
 */
export function stopScheduler(officeId?: string): void {
  if (officeId) {
    const sched = schedulers.get(officeId);
    if (sched) {
      for (const timer of sched.timers) clearInterval(timer.interval);
      schedulers.delete(officeId);
      console.log(`cron-scheduler: stopped for office ${officeId}`);
    }
  } else {
    // Backward compat: clear all
    for (const sched of schedulers.values()) {
      for (const timer of sched.timers) clearInterval(timer.interval);
    }
    schedulers.clear();
    console.log('cron-scheduler: stopped all');
  }
}

/**
 * Reload the scheduler by stopping and restarting with current office data.
 * Called when cron jobs are modified via API.
 */
export function reloadScheduler(
  office: Office,
  resolveTargets: ResolveTargetsFn,
  injectFn: InjectFn,
): void {
  stopScheduler(office.id);
  startScheduler(office, resolveTargets, injectFn);
}

/**
 * Get the current status of the scheduler and all tracked jobs.
 */
export function getSchedulerStatus(officeId?: string): {
  running: boolean;
  jobs: Array<{
    id: string;
    name: string;
    schedule: string;
    enabled: boolean;
    lastRun?: string;
    nextRun?: string;
  }>;
} {
  if (officeId) {
    const sched = schedulers.get(officeId);
    return {
      running: sched?.running ?? false,
      jobs: (sched?.timers ?? []).map(timer => ({
        id: timer.jobId,
        name: timer.name,
        schedule: timer.schedule,
        enabled: timer.enabled,
        nextRun: timer.nextRun.toISOString(),
      })),
    };
  }
  // Backward compat: return first running scheduler
  for (const sched of schedulers.values()) {
    if (sched.running) {
      return {
        running: true,
        jobs: sched.timers.map(timer => ({
          id: timer.jobId,
          name: timer.name,
          schedule: timer.schedule,
          enabled: timer.enabled,
          nextRun: timer.nextRun.toISOString(),
        })),
      };
    }
  }
  return { running: false, jobs: [] };
}

/**
 * Get enriched scheduler status using the office data for job metadata.
 */
export function getSchedulerStatusWithOffice(office: Office): {
  running: boolean;
  jobs: Array<{
    id: string;
    name: string;
    schedule: string;
    enabled: boolean;
    lastRun?: string;
    nextRun?: string;
  }>;
} {
  const sched = schedulers.get(office.id);
  const cronJobs = office.cronJobs ?? [];

  return {
    running: sched?.running ?? false,
    jobs: cronJobs.map(job => {
      const timer = sched?.timers.find(t => t.jobId === job.id);
      return {
        id: job.id,
        name: job.name,
        schedule: job.schedule,
        enabled: job.enabled,
        lastRun: job.lastRun,
        nextRun: timer ? timer.nextRun.toISOString() : undefined,
      };
    }),
  };
}
