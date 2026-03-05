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
import { killAll, validateCliTools } from './pty-manager.js';
import { detectDocker, isDockerAvailable, isImageBuilt, buildImage } from './docker-builder.js';
import { persistStateNow } from './services/session-persistence.js';
import { migrateFromRosters } from './services/office-store.js';
import { initNotificationManager, getNotifications } from './services/notification-manager.js';
import { rehydrateCheckoutLocks } from './services/task-board.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3010', 10);

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
app.use('/api/agents', agentRoutes);
app.use('/api/swarm', swarmRoutes);
app.use('/api/swarm/tasks', taskRoutes);
app.use('/api/swarm/crons', cronRoutes);
app.use('/api/swarm/files', workspaceRoutes);
app.use('/api/offices', officeRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/project', projectRoutes);
app.use('/api/worktrees', worktreeRoutes);

app.get('/api/notifications', (req, res) => {
  const officeId = req.query.officeId as string | undefined;
  res.json({ notifications: getNotifications(officeId) });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'agent-swarm' });
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

  await migrateFromRosters();
  await rehydrateCheckoutLocks();
  console.log(`Agent Swarm server on http://localhost:${PORT}`);
  console.log(`WebSocket on ws://localhost:${PORT}/ws`);
  validateCliTools();
  await detectDocker();
  // Session restore is deferred — client drives via POST /api/sessions/restore
  activateSessionStreaming();
});

function shutdown() {
  console.log('\nShutting down...');
  try {
    persistStateNow();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error(`Failed to persist session state on shutdown: ${message}`);
  }
  killAll();
  server.close();
  // Force exit after 1s in case PTY cleanup hangs
  setTimeout(() => process.exit(0), 1000).unref();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
