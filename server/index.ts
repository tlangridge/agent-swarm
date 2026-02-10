import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { handleWebSocket } from './ws-handler.js';
import { agentRoutes } from './routes/agents.js';
import { killAll, validateCliTools } from './pty-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);

const app = express();
app.use(express.json());
app.use('/api/agents', agentRoutes);

// Serve built client in production
const distPath = path.join(__dirname, '../client/dist');
app.use(express.static(distPath));
app.get('/{*path}', (_req, res, next) => {
  if (_req.path.startsWith('/api') || _req.path.startsWith('/ws')) return next();
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) next();
  });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', handleWebSocket);

server.listen(PORT, () => {
  console.log(`Agent Swarm server on http://localhost:${PORT}`);
  console.log(`WebSocket on ws://localhost:${PORT}/ws`);
  validateCliTools();
});

function shutdown() {
  console.log('\nShutting down...');
  killAll();
  server.close();
  // Force exit after 1s in case PTY cleanup hangs
  setTimeout(() => process.exit(0), 1000).unref();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
