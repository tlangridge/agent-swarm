import { AgentMailClient } from 'agentmail';

let client: AgentMailClient | null = null;

function getClient(): AgentMailClient | null {
  if (!process.env.AGENTMAIL_API_KEY) return null;
  if (!client) {
    client = new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY });
  }
  return client;
}

export async function provisionInbox(agentName: string): Promise<{ email: string; inboxId: string } | null> {
  const c = getClient();
  if (!c) return null;

  const base = agentName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  // Try the clean username first, then add a random suffix if taken
  for (let attempt = 0; attempt < 3; attempt++) {
    const username = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      const inbox = await c.inboxes.create({ username });
      return {
        email: inbox.inboxId,
        inboxId: inbox.inboxId,
      };
    } catch (err: unknown) {
      const body = (err as { body?: { name?: string } }).body;
      if (body?.name === 'IsTakenError' && attempt < 2) continue;
      throw err;
    }
  }

  return null;
}

export async function deleteInbox(inboxId: string): Promise<void> {
  const c = getClient();
  if (!c) return;
  await c.inboxes.delete(inboxId);
}

export function isConfigured(): boolean {
  return !!process.env.AGENTMAIL_API_KEY;
}
