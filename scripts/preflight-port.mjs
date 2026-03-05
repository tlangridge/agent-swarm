import fs from 'fs';
import net from 'net';
import path from 'path';
import { execFileSync } from 'child_process';

function readPortFromDotEnv() {
  const envPath = path.join(process.cwd(), '.env');
  try {
    const raw = fs.readFileSync(envPath, 'utf-8');
    const line = raw.split(/\r?\n/).find((entry) => entry.startsWith('PORT='));
    if (!line) return null;
    const value = line.slice('PORT='.length).trim();
    const port = Number.parseInt(value, 10);
    return Number.isFinite(port) ? port : null;
  } catch {
    return null;
  }
}

function resolvePort() {
  const envPort = Number.parseInt(process.env.PORT || '', 10);
  if (Number.isFinite(envPort)) return envPort;
  const dotEnvPort = readPortFromDotEnv();
  if (dotEnvPort !== null) return dotEnvPort;
  return 3010;
}

function findPortOwner(port) {
  try {
    const raw = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc'], { encoding: 'utf-8' });
    const pidMatch = raw.match(/^p(\d+)$/m);
    if (!pidMatch) return null;
    const pid = Number.parseInt(pidMatch[1], 10);
    if (!Number.isFinite(pid)) return null;

    let cwd = null;
    try {
      const cwdRaw = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf-8' });
      const cwdMatch = cwdRaw.match(/^n(.+)$/m);
      cwd = cwdMatch ? cwdMatch[1] : null;
    } catch {
      cwd = null;
    }

    let command = null;
    try {
      const commandRaw = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf-8' }).trim();
      command = commandRaw || null;
    } catch {
      command = null;
    }

    return { pid, cwd, command };
  } catch {
    return null;
  }
}

function isOwnDevServer(owner) {
  if (!owner) return false;
  if (owner.cwd !== process.cwd()) return false;
  return owner.command?.includes('server/index.ts') ?? false;
}

const port = resolvePort();
const probe = net.createServer();

probe.once('error', (err) => {
  if (err && typeof err === 'object' && 'code' in err && err.code === 'EADDRINUSE') {
    const owner = findPortOwner(port);
    console.error(`\nCannot start dev server: port ${port} is already in use.`);
    console.error(`Repo: ${process.cwd()}`);
    if (isOwnDevServer(owner)) {
      console.error(`A previous server for this repo is still running on pid ${owner.pid}. Stop it, or reuse the existing dev session.`);
    } else if (owner?.pid) {
      console.error(`Port owner pid: ${owner.pid}`);
      if (owner.cwd) console.error(`Port owner cwd: ${owner.cwd}`);
      if (owner.command) console.error(`Port owner command: ${owner.command}`);
      console.error('If you run multiple checkouts (e.g. stable + development), give each a unique PORT in .env.');
    } else {
      console.error('If you run multiple checkouts (e.g. stable + development), give each a unique PORT in .env.');
    }
    process.exit(1);
    return;
  }
  const message = err instanceof Error ? err.message : 'unknown error';
  console.error(`\nPort preflight failed: ${message}`);
  process.exit(1);
});

probe.once('listening', () => {
  probe.close(() => process.exit(0));
});

probe.listen(port);
