import { Router, type Request } from 'express';
import { nanoid } from 'nanoid';
import { getMember, getMembers } from '../services/swarm-registry.js';
import type { FunctionalRole } from '../services/swarm-registry.js';
import { getActiveShift } from '../services/shift-manager.js';
import { getOffice, saveOffice } from '../services/office-store.js';
import type { CronJob } from '../services/office-store.js';
import { reloadScheduler, getSchedulerStatusWithOffice } from '../services/cron-scheduler.js';
import { injectMessage } from '../services/pty-writer.js';

export const cronRoutes = Router();

/**
 * Resolve target session IDs for a cron job based on its targeting config.
 */
function resolveTargets(job: CronJob): string[] {
  const members = getMembers();
  const sessionIds: string[] = [];

  if (job.targetAgent) {
    const lower = job.targetAgent.toLowerCase();
    for (const m of members) {
      if (m.agentName?.toLowerCase() === lower) {
        sessionIds.push(m.sessionId);
      }
    }
  } else if (job.targetRole) {
    for (const m of members) {
      if (m.functionalRole === job.targetRole) {
        sessionIds.push(m.sessionId);
      }
    }
  } else {
    // No target specified — fire for all active agents
    for (const m of members) {
      sessionIds.push(m.sessionId);
    }
  }

  return sessionIds;
}

/**
 * Resolve office from query param, sender header, or active shift.
 */
async function getActiveOffice(req: Request) {
  const qId = req.query.officeId as string | undefined;
  if (qId) return getOffice(qId);
  const sessionId = req.headers['x-session-id'] as string | undefined;
  if (sessionId) {
    const member = getMember(sessionId);
    if (member?.officeId) return getOffice(member.officeId);
  }
  const shift = getActiveShift();
  return shift ? getOffice(shift.officeId) : null;
}

/**
 * Helper to reload the scheduler with current office data.
 */
function triggerReload(office: Parameters<typeof reloadScheduler>[0]) {
  reloadScheduler(office, resolveTargets, injectMessage);
}

// GET / — List cron jobs for the active office
cronRoutes.get('/', async (req, res) => {
  const office = await getActiveOffice(req);
  if (!office) {
    return res.json({ cronJobs: [], scheduler: { running: false, jobs: [] } });
  }

  const scheduler = getSchedulerStatusWithOffice(office);
  res.json({ cronJobs: office.cronJobs ?? [], scheduler });
});

// POST / — Create a cron job
cronRoutes.post('/', async (req, res) => {
  const sessionId = req.headers['x-session-id'] as string;
  const member = sessionId ? getMember(sessionId) : undefined;

  // Allow user-created jobs (no session ID) or agent-created jobs (valid session)
  const createdBy = member?.agentName ?? 'user';

  const office = await getActiveOffice(req);
  if (!office) {
    return res.status(400).json({ error: 'No active shift. Badge in first.' });
  }

  const { name, schedule, targetRole, targetAgent, prompt, enabled } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: "Missing 'name' field" });
  }
  if (!schedule || typeof schedule !== 'string') {
    return res.status(400).json({ error: "Missing 'schedule' field" });
  }
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: "Missing 'prompt' field" });
  }

  // Validate schedule format
  const scheduleMatch = schedule.match(/^every\s+(\d+)\s*(s|m|h)$/i);
  if (!scheduleMatch || parseInt(scheduleMatch[1], 10) <= 0) {
    return res.status(400).json({ error: 'Invalid schedule format. Use "every Nm", "every Nh", or "every Ns".' });
  }

  const job: CronJob = {
    id: nanoid(8),
    name,
    schedule,
    targetRole: targetRole as FunctionalRole | undefined,
    targetAgent: targetAgent as string | undefined,
    prompt,
    enabled: enabled !== false, // default to enabled
    createdBy,
  };

  if (!office.cronJobs) {
    office.cronJobs = [];
  }
  office.cronJobs.push(job);
  office.updatedAt = new Date().toISOString();
  await saveOffice(office);

  triggerReload(office);

  res.status(201).json(job);
});

// PUT /:id — Update a cron job
cronRoutes.put('/:id', async (req, res) => {
  const sessionId = req.headers['x-session-id'] as string;
  if (sessionId && !getMember(sessionId)) {
    return res.status(401).json({ error: 'Invalid X-Session-Id header' });
  }

  const office = await getActiveOffice(req);
  if (!office) {
    return res.status(400).json({ error: 'No active shift. Badge in first.' });
  }

  const jobs = office.cronJobs ?? [];
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: `Cron job "${req.params.id}" not found` });
  }

  const { name, schedule, targetRole, targetAgent, prompt, enabled } = req.body;

  if (name !== undefined) job.name = name;
  if (schedule !== undefined) {
    const scheduleMatch = schedule.match(/^every\s+(\d+)\s*(s|m|h)$/i);
    if (!scheduleMatch || parseInt(scheduleMatch[1], 10) <= 0) {
      return res.status(400).json({ error: 'Invalid schedule format. Use "every Nm", "every Nh", or "every Ns".' });
    }
    job.schedule = schedule;
  }
  if (targetRole !== undefined) job.targetRole = targetRole;
  if (targetAgent !== undefined) job.targetAgent = targetAgent;
  if (prompt !== undefined) job.prompt = prompt;
  if (enabled !== undefined) job.enabled = enabled;

  office.updatedAt = new Date().toISOString();
  await saveOffice(office);

  triggerReload(office);

  res.json(job);
});

// DELETE /:id — Delete a cron job
cronRoutes.delete('/:id', async (req, res) => {
  const sessionId = req.headers['x-session-id'] as string;
  if (sessionId && !getMember(sessionId)) {
    return res.status(401).json({ error: 'Invalid X-Session-Id header' });
  }

  const office = await getActiveOffice(req);
  if (!office) {
    return res.status(400).json({ error: 'No active shift. Badge in first.' });
  }

  const jobs = office.cronJobs ?? [];
  const index = jobs.findIndex(j => j.id === req.params.id);
  if (index < 0) {
    return res.status(404).json({ error: `Cron job "${req.params.id}" not found` });
  }

  jobs.splice(index, 1);
  office.cronJobs = jobs;
  office.updatedAt = new Date().toISOString();
  await saveOffice(office);

  triggerReload(office);

  res.json({ deleted: true, id: req.params.id });
});

// POST /:id/toggle — Toggle a cron job enabled/disabled
cronRoutes.post('/:id/toggle', async (req, res) => {
  const sessionId = req.headers['x-session-id'] as string;
  if (sessionId && !getMember(sessionId)) {
    return res.status(401).json({ error: 'Invalid X-Session-Id header' });
  }

  const office = await getActiveOffice(req);
  if (!office) {
    return res.status(400).json({ error: 'No active shift. Badge in first.' });
  }

  const jobs = office.cronJobs ?? [];
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: `Cron job "${req.params.id}" not found` });
  }

  job.enabled = !job.enabled;
  office.updatedAt = new Date().toISOString();
  await saveOffice(office);

  triggerReload(office);

  res.json(job);
});
