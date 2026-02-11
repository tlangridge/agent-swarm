import { Router } from 'express';
import { randomUUID } from 'crypto';
import { nanoid } from 'nanoid';
import { getMembers, getMember, getMemberByName, getLeadSessionId, addMember, swarmEvents } from '../services/swarm-registry.js';
import { listAgents, saveAgent } from '../services/agent-store.js';
import { provisionInbox } from '../services/agentmail.js';
import { spawnSession, sessions, PORT } from '../pty-manager.js';
import type { CliType } from '../pty-manager.js';
import { buildOrientationMessage } from '../services/swarm-prompts.js';
import type { SwarmRole } from '../services/swarm-registry.js';

export const swarmRoutes = Router();

/**
 * Write text to a PTY in small chunks to avoid triggering paste detection
 * in CLI tools like Claude Code. Returns a promise that resolves when
 * all chunks have been written.
 */
function writeChunked(
  ptyProcess: { write(data: string): void },
  text: string,
): Promise<void> {
  const CHUNK_SIZE = 32;
  const CHUNK_DELAY = 10; // ms between chunks

  return new Promise((resolve) => {
    if (text.length <= CHUNK_SIZE) {
      ptyProcess.write(text);
      resolve();
      return;
    }
    let offset = 0;
    function next() {
      const chunk = text.slice(offset, offset + CHUNK_SIZE);
      ptyProcess.write(chunk);
      offset += CHUNK_SIZE;
      if (offset >= text.length) resolve();
      else setTimeout(next, CHUNK_DELAY);
    }
    next();
  });
}

// GET /api/swarm/agents — List active swarm members + available (inactive) agents
swarmRoutes.get('/agents', async (_req, res) => {
  const active = getMembers();
  const activeAgentIds = new Set(active.map(m => m.agentId).filter(Boolean));

  const allAgents = await listAgents();
  const available = allAgents.filter(a => !activeAgentIds.has(a.id));

  res.json({
    active,
    available: available.map(a => ({ id: a.id, name: a.name, email: a.email })),
    leadSessionId: getLeadSessionId(),
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

  const target = getMemberByName(to);
  if (!target) {
    return res.status(404).json({ error: `Agent '${to}' not found in swarm` });
  }

  const sender = getMember(senderSessionId)!;
  const session = sessions.get(target.sessionId);
  if (!session) {
    return res.status(404).json({ error: `Session for agent '${to}' no longer active` });
  }

  const senderName = sender.agentName || 'Anonymous';
  const formatted = `[SWARM from ${senderName}]: ${message}`;
  writeChunked(session.pty, formatted).then(() => {
    setTimeout(() => session.pty.write('\r'), 50);
  });

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

  const sender = getMember(senderSessionId)!;
  const senderName = sender.agentName || 'Anonymous';
  const formatted = `[SWARM from ${senderName}]: ${message}`;

  let recipientCount = 0;
  for (const member of getMembers()) {
    if (member.sessionId === senderSessionId) continue;
    const session = sessions.get(member.sessionId);
    if (session) {
      writeChunked(session.pty, formatted).then(() => {
        setTimeout(() => session.pty.write('\r'), 50);
      });
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

  const { name, cliType: requestedCliType, role: requestedRole, task } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: "Missing 'name' field" });
  }

  // Enforce max agents
  if (sessions.size >= MAX_AGENTS) {
    return res.status(400).json({ error: `Maximum agent limit reached (${MAX_AGENTS} agents)`, currentCount: sessions.size });
  }

  // Reject if already running
  if (getMemberByName(name)) {
    return res.status(400).json({ error: `Agent '${name}' is already running in the swarm` });
  }

  const swarmRole: SwarmRole = requestedRole || 'worker';
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
    try {
      spawnSession(sessionId, cliType, 80, 24, agent, 'local', 'autonomous', swarmRole);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to spawn terminal';
      console.error(`PTY spawn failed for ${cliType}:`, message);
      return res.status(500).json({ error: `Failed to launch ${cliType}: ${message}` });
    }

    // Register in swarm
    addMember({
      sessionId,
      agentId: agent.id,
      agentName: agent.name,
      agentEmail: agent.email,
      cliType,
      executionMode: 'local',
      role: swarmRole,
      joinedAt: new Date().toISOString(),
    });

    // Emit event for ws-handler to set up output broadcasting + notify clients
    swarmEvents.emit('session:spawned', {
      sessionId,
      agentId: agent.id,
      agentName: agent.name,
      agentEmail: agent.email,
      cliType,
      executionMode: 'local',
      swarmRole,
    });

    // For non-Claude/non-bash CLIs, inject orientation message
    if (cliType !== 'claude' && cliType !== 'bash') {
      const swarmApiUrl = `http://localhost:${PORT}`;
      const orientation = buildOrientationMessage(swarmRole, agent.name, sessionId, swarmApiUrl);
      setTimeout(() => {
        const s = sessions.get(sessionId);
        if (s) s.pty.write(orientation);
      }, 500);
    }

    // If initial task provided, send it as a swarm message from the spawner
    if (task && typeof task === 'string') {
      const sender = getMember(senderSessionId);
      const senderName = sender?.agentName || 'Anonymous';
      setTimeout(() => {
        const s = sessions.get(sessionId);
        if (s) {
          const taskMsg = `[SWARM from ${senderName}]: ${task}`;
          writeChunked(s.pty, taskMsg).then(() => {
            setTimeout(() => {
              const s2 = sessions.get(sessionId);
              if (s2) s2.pty.write('\r');
            }, 50);
          });
        }
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
