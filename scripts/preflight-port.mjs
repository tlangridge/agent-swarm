import fs from 'fs';
import net from 'net';
import path from 'path';

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

const port = resolvePort();
const probe = net.createServer();

probe.once('error', (err) => {
  if (err && typeof err === 'object' && 'code' in err && err.code === 'EADDRINUSE') {
    console.error(`\nCannot start dev server: port ${port} is already in use.`);
    console.error(`Repo: ${process.cwd()}`);
    console.error('If you run multiple checkouts (e.g. stable + development), give each a unique PORT in .env.');
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
