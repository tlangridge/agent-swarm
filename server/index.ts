import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { handleWebSocket, activateSessionStreaming } from './ws-handler.js';
import { agentRoutes } from './routes/agents.js';
import { swarmRoutes } from './routes/swarm.js';
import { officeRoutes } from './routes/offices.js';
import { taskRoutes } from './routes/tasks.js';
import { cronRoutes } from './routes/crons.js';
import { workspaceRoutes } from './routes/workspace.js';
import { projectRoutes } from './routes/project.js';
import { worktreeRoutes } from './routes/worktrees.js';
import { sessionRoutes } from './routes/sessions.js';
import { keyRoutes } from './routes/keys.js';
import { killAll, validateCliTools } from './pty-manager.js';
import { detectDocker, isDockerAvailable, isImageBuilt, buildImage } from './docker-builder.js';
import { persistStateNow, getSavedSessionIds } from './services/session-persistence.js';
import { migrateFromRosters } from './services/office-store.js';
import { initNotificationManager, getNotifications } from './services/notification-manager.js';
import { rehydrateCheckoutLocks } from './services/task-board.js';
import { cleanupOrphanedSkillDirs } from './services/skill-injector.js';
import { ensureKeyDirs } from './services/key-store.js';
import { getServerInstanceId } from './services/instance-id.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3010', 10);
const SERVER_INSTANCE_ID = getServerInstanceId();

const app = express();
// Custom JSON parser that sanitizes Unicode smart quotes before parsing.
// LLMs frequently emit curly quotes (\u201c \u201d \u2018 \u2019) in JSON,
// which breaks standard JSON parsing.
app.use((req, res, next) => {
  if (!req.headers['content-type']?.includes('application/json')) {
    return next();
  }

  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    try {
      let raw = Buffer.concat(chunks).toString('utf-8');
      raw = raw
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'");
      req.body = JSON.parse(raw);
      next();
    } catch {
      res.status(400).json({ error: 'Invalid JSON' });
    }
  });
  req.on('error', next);
});
app.use((req, res, next) => {
  const header = req.headers['x-swarm-instance-id'];
  if (!header) return next();
  const provided = Array.isArray(header) ? header[0] : header;
  if (!provided) return next();

  if (provided !== SERVER_INSTANCE_ID) {
    return res.status(409).json({
      error: 'Swarm instance mismatch',
      expectedInstanceId: SERVER_INSTANCE_ID,
      providedInstanceId: provided,
    });
  }

  next();
});
app.use('/api/agents', agentRoutes);
app.use('/api/swarm', swarmRoutes);
app.use('/api/swarm/tasks', taskRoutes);
app.use('/api/swarm/crons', cronRoutes);
app.use('/api/swarm/files', workspaceRoutes);
app.use('/api/offices', officeRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/project', projectRoutes);
app.use('/api/worktrees', worktreeRoutes);
app.use('/api/keys', keyRoutes);

app.get('/api/notifications', (req, res) => {
  const officeId = req.query.officeId as string | undefined;
  res.json({ notifications: getNotifications(officeId) });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'agent-swarm', instanceId: SERVER_INSTANCE_ID });
});

// Docker status endpoint
app.get('/api/docker/status', (_req, res) => {
  res.json({ dockerAvailable: isDockerAvailable(), imageBuilt: isImageBuilt() });
});

// Docker build endpoint (streams build output)
app.post('/api/docker/build', (_req, res) => {
  if (!isDockerAvailable()) {
    return res.status(400).json({ error: 'Docker is not available on this system' });
  }

  console.log('Docker image build started...');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  buildImage((line) => {
    process.stdout.write(line);
    res.write(line);
  }).then((success) => {
    console.log(success ? 'Docker image build succeeded' : 'Docker image build failed');
    res.end(success ? '\nDone.' : '\nFailed.');
  });
});

// Serve built client in production
const distPath = path.join(__dirname, '../client/dist');
app.use(express.static(distPath));
app.get('/{*path}', (_req, res, next) => {
  if (_req.path.startsWith('/api') || _req.path.startsWith('/ws')) return next();
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) next();
  });
});

initNotificationManager();

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', handleWebSocket);

function handleServerStartupError(err: unknown): never {
  const errno = err as NodeJS.ErrnoException;
  if (errno?.code === 'EADDRINUSE') {
    console.error(`\nFailed to start Agent Swarm: port ${PORT} is already in use.`);
    console.error(`Current repo: ${process.cwd()}`);
    console.error('Another local service (often another agent-swarm checkout) is already listening on this port.');
    console.error('Set a unique PORT in this repo\'s .env, then restart both dev server and client.');
    process.exit(1);
  }
  const message = errno?.message || 'unknown server error';
  console.error(`\nFailed to start Agent Swarm server: ${message}`);
  process.exit(1);
}

server.on('error', (err: NodeJS.ErrnoException) => {
  handleServerStartupError(err);
});
wss.on('error', (err: Error) => {
  handleServerStartupError(err);
});

async function verifyLocalRouting(port: number): Promise<void> {
  const urls = [`http://localhost:${port}/api/health`, `http://127.0.0.1:${port}/api/health`];

  for (const url of urls) {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('application/json')) {
      throw new Error(`Unexpected response from ${url} (${response.status} ${contentType || 'unknown content type'})`);
    }

    const body = await response.json() as { ok?: boolean; service?: string };
    if (body.ok !== true || body.service !== 'agent-swarm') {
      throw new Error(`Unexpected service response from ${url}`);
    }
  }
}

server.listen(PORT, async () => {
  try {
    await verifyLocalRouting(PORT);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error(`\nBackend port check failed for localhost:${PORT}.`);
    console.error('Another local service is handling this port. Update PORT in .env to an unused value and restart.');
    console.error(`Details: ${message}`);
    process.exit(1);
    return;
  }

  ensureKeyDirs();
  await migrateFromRosters();
  await rehydrateCheckoutLocks(new Set(getSavedSessionIds()));
  cleanupOrphanedSkillDirs();
  console.log(`Agent Swarm server on http://localhost:${PORT}`);
  console.log(`WebSocket on ws://localhost:${PORT}/ws`);
  validateCliTools();
  await detectDocker();
  // Session restore is deferred — client drives via POST /api/sessions/restore
  activateSessionStreaming();
});

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nShutting down...');
  try {
    persistStateNow();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error(`Failed to persist session state on shutdown: ${message}`);
  }
  killAll();
  const forceExit = setTimeout(() => process.exit(0), 1000);
  forceExit.unref();
  wss.close();
  server.close(() => {
    clearTimeout(forceExit);
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
