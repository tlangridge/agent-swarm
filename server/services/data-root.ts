import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_ROOT = path.join(__dirname, '../../data');

export function getDataRoot(): string {
  const override = process.env.AGENT_SWARM_DATA_DIR?.trim();
  if (override) return path.resolve(override);
  return DEFAULT_DATA_ROOT;
}

export function getDataPath(...parts: string[]): string {
  return path.join(getDataRoot(), ...parts);
}
