import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = path.join(__dirname, '../../data/agents');

export interface AgentIdentity {
  id: string;
  name: string;
  email: string;
  inboxId: string;
  credentials: Record<string, string>;
  defaultCliType: string | null;
  soul?: string;
  memory?: string;
  instructions?: string;
  createdAt: string;
  updatedAt: string;
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(AGENTS_DIR, { recursive: true });
}

export async function listAgents(): Promise<AgentIdentity[]> {
  await ensureDir();
  const files = await fs.readdir(AGENTS_DIR);
  const agents: AgentIdentity[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const data = await fs.readFile(path.join(AGENTS_DIR, f), 'utf-8');
    agents.push(JSON.parse(data));
  }
  return agents.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAgent(id: string): Promise<AgentIdentity | null> {
  try {
    const data = await fs.readFile(path.join(AGENTS_DIR, `${id}.json`), 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function saveAgent(agent: AgentIdentity): Promise<void> {
  await ensureDir();
  await fs.writeFile(
    path.join(AGENTS_DIR, `${agent.id}.json`),
    JSON.stringify(agent, null, 2),
  );
}

export async function deleteAgent(id: string): Promise<boolean> {
  try {
    await fs.unlink(path.join(AGENTS_DIR, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}
