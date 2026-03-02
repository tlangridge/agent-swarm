import { Router } from 'express';
import { nanoid } from 'nanoid';
import { listOffices, getOffice, saveOffice, deleteOffice } from '../services/office-store.js';
import { badgeIn, badgeOut, getActiveShift, markReadyForReview } from '../services/shift-manager.js';
import { swarmEvents } from '../services/swarm-registry.js';

export const officeRoutes = Router();

// GET /api/offices — List all offices
officeRoutes.get('/', async (_req, res) => {
  const offices = await listOffices();
  res.json({ offices, activeShift: getActiveShift() });
});

// GET /api/offices/:id — Get a single office
officeRoutes.get('/:id', async (req, res) => {
  const office = await getOffice(req.params.id);
  if (!office) return res.status(404).json({ error: 'Office not found' });
  res.json(office);
});

// POST /api/offices — Create a new office
officeRoutes.post('/', async (req, res) => {
  const { name, slots, pipeline, cronJobs, projectPath, soul, memory, instructions } = req.body;
  if (!name || !slots || !Array.isArray(slots) || slots.length === 0) {
    return res.status(400).json({ error: 'Missing name or slots array' });
  }

  const now = new Date().toISOString();
  const office = {
    id: nanoid(8),
    name,
    slots,
    pipeline: pipeline || undefined,
    cronJobs: cronJobs || undefined,
    projectPath: projectPath || undefined,
    soul: soul || undefined,
    memory: memory || undefined,
    instructions: instructions || undefined,
    createdAt: now,
    updatedAt: now,
  };

  await saveOffice(office);
  res.status(201).json(office);
});

// PUT /api/offices/:id — Update an office
officeRoutes.put('/:id', async (req, res) => {
  const existing = await getOffice(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Office not found' });

  const { name, slots, pipeline, cronJobs, projectPath, soul, memory, instructions } = req.body;
  if (name !== undefined) existing.name = name;
  if (slots !== undefined) existing.slots = slots;
  if (pipeline !== undefined) existing.pipeline = pipeline;
  if (cronJobs !== undefined) existing.cronJobs = cronJobs;
  if (projectPath !== undefined) existing.projectPath = projectPath || undefined;
  if (soul !== undefined) existing.soul = soul || undefined;
  if (memory !== undefined) existing.memory = memory || undefined;
  if (instructions !== undefined) existing.instructions = instructions || undefined;
  existing.updatedAt = new Date().toISOString();

  await saveOffice(existing);
  res.json(existing);
});

// DELETE /api/offices/:id — Delete an office
officeRoutes.delete('/:id', async (req, res) => {
  const deleted = await deleteOffice(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Office not found' });
  res.json({ deleted: true });
});

// POST /api/offices/:id/badge-in — Start a shift
officeRoutes.post('/:id/badge-in', async (req, res) => {
  const office = await getOffice(req.params.id);
  if (!office) return res.status(404).json({ error: 'Office not found' });

  try {
    // Return immediately, boot happens async
    res.json({ started: true, officeId: office.id, officeName: office.name });

    // Broadcast function for shift progress
    const broadcast = (data: unknown) => {
      swarmEvents.emit('shift:broadcast', data);
    };

    await badgeIn(office, broadcast);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    // If we already sent the response, log the error
    if (res.headersSent) {
      console.error('Badge-in error (post-response):', message);
    } else {
      res.status(400).json({ error: message });
    }
  }
});

// POST /api/offices/:id/badge-out — End a shift
officeRoutes.post('/:id/badge-out', async (_req, res) => {
  const shift = await badgeOut();
  if (!shift) return res.status(400).json({ error: 'No active shift to end' });
  res.json({ ended: true, shift });
});

// POST /api/offices/:id/ready-for-review — Lead agent marks shift as ready for review
officeRoutes.post('/:id/ready-for-review', (req, res) => {
  const sessionId = req.headers['x-session-id'] as string;
  if (!sessionId) {
    return res.status(401).json({ error: 'Missing X-Session-Id header' });
  }

  const { summary } = req.body;
  if (!summary || typeof summary !== 'string') {
    return res.status(400).json({ error: 'Missing summary' });
  }

  const result = markReadyForReview(sessionId, summary);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  res.json({ success: true });
});

// GET /api/offices/:id/shift — Get current shift status
officeRoutes.get('/:id/shift', (req, res) => {
  const shift = getActiveShift();
  if (!shift || shift.officeId !== req.params.id) {
    return res.json({ active: false });
  }
  res.json({ active: true, shift });
});
