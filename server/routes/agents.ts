import { Router } from 'express';
import { nanoid } from 'nanoid';
import { listAgents, getAgent, saveAgent, deleteAgent } from '../services/agent-store.js';
import { provisionInbox, deleteInbox, isConfigured } from '../services/agentmail.js';
import { isDockerAvailable, isImageBuilt } from '../docker-builder.js';

export const agentRoutes = Router();

agentRoutes.get('/', async (_req, res) => {
  const agents = await listAgents();
  res.json({ agents, agentmailConfigured: isConfigured(), dockerAvailable: isDockerAvailable(), dockerImageBuilt: isImageBuilt() });
});

agentRoutes.get('/:id', async (req, res) => {
  const agent = await getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json(agent);
});

agentRoutes.post('/', async (req, res) => {
  const { name, defaultCliType, soul, memory, instructions } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Name is required' });
  }

  const id = nanoid(8);
  let email = '';
  let inboxId = '';

  try {
    const inbox = await provisionInbox(name);
    if (inbox) {
      email = inbox.email;
      inboxId = inbox.inboxId;
    }
  } catch (err: unknown) {
    console.error('AgentMail provisioning failed:', err);
    // Continue without email — agent can still be created
  }

  const now = new Date().toISOString();
  const agent = {
    id,
    name,
    email,
    inboxId,
    credentials: {},
    defaultCliType: defaultCliType || 'claude',
    soul: soul || undefined,
    memory: memory || undefined,
    instructions: instructions || undefined,
    createdAt: now,
    updatedAt: now,
  };

  await saveAgent(agent);
  res.status(201).json(agent);
});

agentRoutes.put('/:id', async (req, res) => {
  const existing = await getAgent(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Agent not found' });

  const updated = {
    ...existing,
    ...req.body,
    id: existing.id, // prevent id change
    updatedAt: new Date().toISOString(),
  };

  // Convert null values to undefined so they're stripped from the stored JSON
  for (const key of ['soul', 'memory', 'instructions'] as const) {
    if (updated[key] === null) updated[key] = undefined;
  }

  await saveAgent(updated);
  res.json(updated);
});

agentRoutes.delete('/:id', async (req, res) => {
  const agent = await getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  if (agent.inboxId) {
    try {
      await deleteInbox(agent.inboxId);
    } catch (err: unknown) {
      console.error('Failed to delete inbox:', err);
    }
  }

  await deleteAgent(req.params.id);
  res.json({ deleted: true });
});
