import type { SwarmRole } from './swarm-registry.js';

interface AgentInfo {
  name: string;
  email: string;
}

export function buildSwarmPrompt(
  role: SwarmRole,
  agent: AgentInfo,
  sessionId: string,
  swarmApiUrl: string,
  projectPath?: string,
  worktreeBranch?: string,
): string {
  const identity = `Your identity: Name="${agent.name}", Email="${agent.email}".\nYour session ID: ${sessionId}`;
  const api = buildApiReference(sessionId, swarmApiUrl);
  const workContext = buildWorkContext(projectPath, worktreeBranch);

  if (role === 'lead') {
    return `${identity}

=== SWARM COORDINATION ===

You are the LEAD agent in a multi-agent swarm. The user will give you tasks. You should break them down and delegate work to the other agents, then synthesize their results.
${workContext}
${api}

AS LEAD AGENT:
- Start by checking who is in the swarm: curl the agents endpoint
- Delegate tasks to worker agents by sending them clear, specific messages
- Workers will message you back with results — watch for [SWARM from ...] messages
- Report overall progress back to the user
- If you need more agents, spawn them using the spawn API
- You can spawn existing agents from the database or create new ones on the fly

Note: Your role may change during the session. If you receive a [SWARM SYSTEM] message about a role change, adapt your behavior accordingly.`;
  }

  return `${identity}

=== SWARM COORDINATION ===

You are a WORKER agent in a multi-agent swarm. A lead agent will coordinate your work.
${workContext}
${api}

AS A WORKER AGENT:
- The lead agent will send you tasks via [SWARM from ...] messages
- Complete the task, then message the lead agent back with your results
- If you need help from another agent, message them directly
- If you're unsure what to do, check the swarm and message the lead agent

Note: Your role may change during the session. If you receive a [SWARM SYSTEM] message about a role change, adapt your behavior accordingly.`;
}

function buildWorkContext(projectPath?: string, worktreeBranch?: string): string {
  if (!projectPath) return '';
  const lines: string[] = ['', `Working directory: ${projectPath}`];
  if (worktreeBranch) {
    lines.push(`Git branch: ${worktreeBranch} (dedicated worktree — do NOT switch branches)`);
  }
  return lines.join('\n');
}

function buildApiReference(sessionId: string, swarmApiUrl: string): string {
  return `DISCOVERING THE SWARM:
  curl -s ${swarmApiUrl}/api/swarm/agents | jq .
This returns {"active": [...], "available": [...], "leadSessionId": "..."}
- "active" = agents currently running in the swarm (with sessionId, name, role)
- "available" = agents in the database but not currently running

SENDING A MESSAGE TO ANOTHER AGENT:
  curl -s -X POST ${swarmApiUrl}/api/swarm/message \\
    -H "Content-Type: application/json" \\
    -H "X-Session-Id: ${sessionId}" \\
    -d '{"to": "<agent-name>", "message": "<your message>"}'
The message will appear in their terminal. They will see: [SWARM from ...]: <your message>

BROADCASTING TO ALL AGENTS:
  curl -s -X POST ${swarmApiUrl}/api/swarm/broadcast \\
    -H "Content-Type: application/json" \\
    -H "X-Session-Id: ${sessionId}" \\
    -d '{"message": "<your message>"}'

SPAWNING A NEW AGENT:
  curl -s -X POST ${swarmApiUrl}/api/swarm/spawn \\
    -H "Content-Type: application/json" \\
    -H "X-Session-Id: ${sessionId}" \\
    -d '{"name": "<agent-name>", "task": "<optional initial task>"}'
If an agent with that name exists in the database, it will be spawned.
Otherwise a new agent is created automatically. Maximum 10 agents can run simultaneously.

RECEIVING MESSAGES:
When another agent messages you, it appears in your terminal as:
  [SWARM from <their-name>]: <their message>
Respond to it naturally, then message them back if needed.`;
}

export function buildOrientationMessage(
  role: SwarmRole,
  agentName: string | null,
  sessionId: string,
  swarmApiUrl: string,
  projectPath?: string,
  worktreeBranch?: string,
): string {
  const name = agentName || 'Anonymous';
  const lines = [
    '',
    '=== SWARM COORDINATION ===',
    `You are "${name}" (${role}) in a multi-agent swarm.`,
    `Session ID: ${sessionId}`,
  ];

  if (projectPath) {
    lines.push(`Working directory: ${projectPath}`);
    if (worktreeBranch) {
      lines.push(`Git branch: ${worktreeBranch} (dedicated worktree)`);
    }
  }

  lines.push(
    '',
    'Swarm API:',
    `  List agents:    curl -s ${swarmApiUrl}/api/swarm/agents`,
    `  Send message:   curl -s -X POST ${swarmApiUrl}/api/swarm/message -H "Content-Type: application/json" -H "X-Session-Id: ${sessionId}" -d '{"to":"<name>","message":"<text>"}'`,
    `  Broadcast:      curl -s -X POST ${swarmApiUrl}/api/swarm/broadcast -H "Content-Type: application/json" -H "X-Session-Id: ${sessionId}" -d '{"message":"<text>"}'`,
    `  Spawn agent:    curl -s -X POST ${swarmApiUrl}/api/swarm/spawn -H "Content-Type: application/json" -H "X-Session-Id: ${sessionId}" -d '{"name":"<name>","task":"<optional task>"}'`,
    '',
    'Incoming messages appear as: [SWARM from <name>]: <message>',
    'Maximum 10 agents can run simultaneously.',
    '===========================',
    '',
  );

  return lines.join('\r\n');
}
