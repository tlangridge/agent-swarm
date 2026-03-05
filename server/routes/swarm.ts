import { Router } from 'express';
import { randomUUID } from 'crypto';
import { nanoid } from 'nanoid';
import { getMembers, getMember, getMemberByName, getMembersByOffice, getLeadSessionId, addMember, swarmEvents } from '../services/swarm-registry.js';
import type { SwarmRole, FunctionalRole } from '../services/swarm-registry.js';
import { listAgents, saveAgent } from '../services/agent-store.js';
import { provisionInbox } from '../services/agentmail.js';
import { spawnSession, sessions, PORT, getSessionByAgentName } from '../pty-manager.js';
import type { CliType } from '../pty-manager.js';
import { buildOrientationMessage } from '../services/swarm-prompts.js';
import { getProjectPath } from './project.js';
import { injectMessage } from '../services/pty-writer.js';
import { getStructuredStatus } from '../services/activity-parser.js';
import { getActiveShift, getShiftBySessionId, spawnSlotOnDemand, rotateAgent } from '../services/shift-manager.js';

export const swarmRoutes = Router();

function stripAnsi(input: string): string {
  return input.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '');
}

// GET /api/swarm/activity — Summary of ALL agents' recent output
swarmRoutes.get('/activity', (req, res) => {
  const senderSessionId = req.headers['x-session-id'] as string;
  if (!senderSessionId || !getMember(senderSessionId)) {
    return res.status(401).json({ error: 'Invalid or missing X-Session-Id header' });
  }

  const sender = getMember(senderSessionId)!;
  const officeMembers = sender.officeId ? getMembersByOffice(sender.officeId) : getMembers();
  const agents = officeMembers.map(member => {
    const session = sessions.get(member.sessionId);
    if (!session) return { name: member.agentName, role: member.functionalRole, lastLines: [], idleSeconds: -1 };

    const cleaned = stripAnsi(session.scrollback).replace(/\r/g, '');
    const allLines = cleaned.split('\n').filter(l => l.trim());
    const lastLines = allLines.slice(-5);
    const idleSeconds = Math.round((Date.now() - session.lastDataAt.getTime()) / 1000);

    return { name: member.agentName, role: member.functionalRole, lastLines, idleSeconds };
  });

  res.json({ agents });
});

// GET /api/swarm/activity/:name — Single agent's recent output
swarmRoutes.get('/activity/:name', (req, res) => {
  const senderSessionId = req.headers['x-session-id'] as string;
  if (!senderSessionId || !getMember(senderSessionId)) {
    return res.status(401).json({ error: 'Invalid or missing X-Session-Id header' });
  }

  const activitySender = getMember(senderSessionId)!;
  const session = getSessionByAgentName(req.params.name, activitySender.officeId || undefined);
  if (!session) {
    return res.status(404).json({ error: `Agent '${req.params.name}' not found or not active` });
  }

  const lines = parseInt(req.query.lines as string) || 50;
  const maxLines = Math.min(Math.max(lines, 1), 200);

  const cleaned = stripAnsi(session.scrollback).replace(/\r/g, '');
  const allLines = cleaned.split('\n').filter(l => l.trim());
  const lastLines = allLines.slice(-maxLines);

  const idleSeconds = Math.round((Date.now() - session.lastDataAt.getTime()) / 1000);

  res.json({
    agent: session.agentName,
    sessionId: session.id,
    lastLines,
    idleSeconds,
    status: 'active',
  });
});

// GET /api/swarm/dashboard — Structured agent status for lead/dashboard
swarmRoutes.get('/dashboard', async (req, res) => {
  const sessionId = req.headers['x-session-id'] as string | undefined;
  const member = sessionId ? getMember(sessionId) : undefined;
  const officeId = (req.query.officeId as string | undefined) || member?.officeId;

  const agents = await getStructuredStatus(officeId);
  res.json({ agents, generatedAt: new Date().toISOString() });
});

// POST /api/swarm/summon — Spawn a pending (unbooted) shift slot by name
swarmRoutes.post('/summon', async (req, res) => {
  const senderSessionId = req.headers['x-session-id'] as string | undefined;
  if (!senderSessionId || !getMember(senderSessionId)) {
    return res.status(401).json({ error: 'Invalid or missing X-Session-Id header' });
  }

  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Missing 'name' field" });
  }

  const summonSender = getMember(senderSessionId);
  const shift = getShiftBySessionId(senderSessionId) ?? getActiveShift(summonSender?.officeId);
  if (!shift) {
    return res.status(400).json({ error: 'No active shift' });
  }

  const pendingSlot = shift.slots.find(
    s => s.name.toLowerCase() === name.toLowerCase() && s.status === 'pending',
  );
  if (!pendingSlot) {
    return res.status(404).json({ error: `No pending slot for "${name}"` });
  }

  const result = await spawnSlotOnDemand(pendingSlot.slotIndex, shift.officeId);
  if (!result) {
    return res.status(500).json({ error: 'Failed to spawn slot' });
  }

  res.json({ spawned: true, slot: result });
});

// GET /api/swarm/agents — List active swarm members + available (inactive) agents
swarmRoutes.get('/agents', async (req, res) => {
  // Scope by office when caller provides X-Session-Id
  const sessionId = req.headers['x-session-id'] as string | undefined;
  const member = sessionId ? getMember(sessionId) : undefined;
  const officeId = (req.query.officeId as string | undefined) || member?.officeId;

  const active = officeId ? getMembersByOffice(officeId) : getMembers();
  const activeAgentIds = new Set(active.map(m => m.agentId).filter(Boolean));

  const allAgents = await listAgents();
  const available = allAgents.filter(a => !activeAgentIds.has(a.id));

  res.json({
    active,
    available: available.map(a => ({ id: a.id, name: a.name, email: a.email })),
    leadSessionId: getLeadSessionId(officeId),
  });
});

// POST /api/swarm/message — Send a message to a specific agent
swarmRoutes.post('/message', (req, res) => {
  const senderSessionId = req.headers['x-session-id'] as string | undefined;
  if (!senderSessionId || !getMember(senderSessionId)) {
    return res.status(401).json({ error: 'Invalid or missing X-Session-Id header' });
  }

  const { to, message } = req.body;
  if (!to || !message) {
    return res.status(400).json({ error: "Missing 'to' or 'message' field" });
  }

  const sender = getMember(senderSessionId)!;
  const target = getMemberByName(to, sender.officeId || undefined);
  if (!target) {
    return res.status(404).json({ error: `Agent '${to}' not found in swarm` });
  }
  const session = sessions.get(target.sessionId);
  if (!session) {
    return res.status(404).json({ error: `Session for agent '${to}' no longer active` });
  }

  const senderName = sender.agentName || 'Anonymous';
  const formatted = `[SWARM from ${senderName}]: ${message}`;
  injectMessage(target.sessionId, formatted);

  res.json({ delivered: true, toSessionId: target.sessionId });
});

// POST /api/swarm/broadcast — Send a message to all other agents
swarmRoutes.post('/broadcast', (req, res) => {
  const senderSessionId = req.headers['x-session-id'] as string | undefined;
  if (!senderSessionId || !getMember(senderSessionId)) {
    return res.status(401).json({ error: 'Invalid or missing X-Session-Id header' });
  }

  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: "Missing 'message' field" });
  }

  const broadcastSender = getMember(senderSessionId)!;
  const senderName = broadcastSender.agentName || 'Anonymous';
  const formatted = `[SWARM from ${senderName}]: ${message}`;

  let recipientCount = 0;
  const broadcastMembers = broadcastSender.officeId ? getMembersByOffice(broadcastSender.officeId) : getMembers();
  for (const member of broadcastMembers) {
    if (member.sessionId === senderSessionId) continue;
    const session = sessions.get(member.sessionId);
    if (session) {
      injectMessage(member.sessionId, formatted);
      recipientCount++;
    }
  }

  res.json({ delivered: true, recipientCount });
});

const MAX_AGENTS = 10;

// POST /api/swarm/spawn — Spawn an existing agent or create a new one
swarmRoutes.post('/spawn', async (req, res) => {
  const senderSessionId = req.headers['x-session-id'] as string | undefined;
  if (!senderSessionId || !getMember(senderSessionId)) {
    return res.status(401).json({ error: 'Invalid or missing X-Session-Id header' });
  }

  const { name, cliType: requestedCliType, role: requestedRole, functionalRole: requestedFunctionalRole, task } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: "Missing 'name' field" });
  }

  // Enforce max agents
  if (sessions.size >= MAX_AGENTS) {
    return res.status(400).json({ error: `Maximum agent limit reached (${MAX_AGENTS} agents)`, currentCount: sessions.size });
  }

  // Reject if already running in this office
  const spawnSender = getMember(senderSessionId)!;
  if (getMemberByName(name, spawnSender.officeId || undefined)) {
    return res.status(400).json({ error: `Agent '${name}' is already running in the swarm` });
  }

  const swarmRole: SwarmRole = requestedRole || 'worker';
  const functionalRole: FunctionalRole | null = requestedFunctionalRole || null;
  let created = false;
  let agent: { id: string; name: string; email: string };
  let cliType: CliType;

  try {
    // Look up existing agent by name
    const allAgents = await listAgents();
    const existing = allAgents.find(a => a.name.toLowerCase() === name.toLowerCase());

    if (existing) {
      agent = { id: existing.id, name: existing.name, email: existing.email };
      cliType = requestedCliType || (existing.defaultCliType as CliType) || 'claude';
    } else {
      // Create new agent
      cliType = requestedCliType || 'claude';
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
        console.error('AgentMail provisioning failed for spawned agent:', err);
      }

      const now = new Date().toISOString();
      await saveAgent({
        id,
        name,
        email,
        inboxId,
        credentials: {},
        defaultCliType: cliType,
        createdAt: now,
        updatedAt: now,
      });

      agent = { id, name, email };
      created = true;
    }

    // Spawn PTY session
    const sessionId = randomUUID();
    const spawnSender = getMember(senderSessionId);
    const spawnOfficeId = spawnSender?.officeId || '';
    try {
      spawnSession(sessionId, cliType, 80, 24, agent, 'local', 'autonomous', swarmRole, getProjectPath() || undefined, functionalRole, undefined, undefined, undefined, spawnOfficeId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to spawn terminal';
      console.error(`PTY spawn failed for ${cliType}:`, message);
      return res.status(500).json({ error: `Failed to launch ${cliType}: ${message}` });
    }

    // Register in swarm
    addMember({
      sessionId,
      officeId: spawnOfficeId,
      agentId: agent.id,
      agentName: agent.name,
      agentEmail: agent.email,
      cliType,
      executionMode: 'local',
      role: swarmRole,
      functionalRole,
      joinedAt: new Date().toISOString(),
    });

    // Emit event for ws-handler to set up output broadcasting + notify clients
    swarmEvents.emit('session:spawned', {
      sessionId,
      officeId: spawnOfficeId,
      agentId: agent.id,
      agentName: agent.name,
      agentEmail: agent.email,
      cliType,
      executionMode: 'local',
      swarmRole,
      functionalRole,
    });

    // For non-Claude/non-bash CLIs, inject orientation message
    if (cliType !== 'claude' && cliType !== 'bash') {
      const swarmApiUrl = `http://localhost:${PORT}`;
      const orientation = buildOrientationMessage(swarmRole, agent.name, sessionId, swarmApiUrl, undefined, undefined, functionalRole);
      setTimeout(() => {
        injectMessage(sessionId, orientation);
      }, 500);
    }

    // If initial task provided, send it as a swarm message from the spawner
    if (task && typeof task === 'string') {
      const sender = getMember(senderSessionId);
      const senderName = sender?.agentName || 'Anonymous';
      const taskMsg = `[SWARM from ${senderName}]: ${task}`;
      setTimeout(() => {
        injectMessage(sessionId, taskMsg);
      }, 2000);
    }

    res.json({
      spawned: true,
      sessionId,
      agent: { id: agent.id, name: agent.name, email: agent.email },
      created,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Spawn route error:', message);
    return res.status(500).json({ error: `Failed to spawn agent: ${message}` });
  }
});

// POST /api/swarm/rotate/:name — Rotate agent (context refresh)
swarmRoutes.post('/rotate/:name', async (req, res) => {
  const senderSessionId = req.headers['x-session-id'] as string;
  if (!senderSessionId || !getMember(senderSessionId)) {
    return res.status(401).json({ error: 'Invalid or missing X-Session-Id header' });
  }
  const sender = getMember(senderSessionId)!;
  const target = getMemberByName(req.params.name, sender.officeId || undefined);
  if (!target) {
    return res.status(404).json({ error: `Agent '${req.params.name}' not found` });
  }
  rotateAgent(target.sessionId, req.body.reason || 'Manual rotation requested');
  res.json({ rotating: true, agent: req.params.name });
});
