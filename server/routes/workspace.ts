import { Router, type Request } from 'express';
import { getMember } from '../services/swarm-registry.js';
import { getActiveShift } from '../services/shift-manager.js';
import { listFiles, readFile, writeFile, appendFile, deleteFile } from '../services/workspace-files.js';

export const workspaceRoutes = Router();

/**
 * Resolve office ID from query param, sender header, or active shift.
 */
function getOfficeId(req: Request): string | null {
  const qId = req.query.officeId as string | undefined;
  if (qId) return qId;
  const sessionId = req.headers['x-session-id'] as string | undefined;
  if (sessionId) {
    const member = getMember(sessionId);
    if (member?.officeId) return member.officeId;
  }
  const shift = getActiveShift();
  return shift?.officeId ?? null;
}

// GET /api/swarm/files — List all workspace files for the active office
workspaceRoutes.get('/', async (req, res) => {
  const officeId = getOfficeId(req);
  if (!officeId) {
    return res.status(400).json({ error: 'No active shift' });
  }

  const index = await listFiles(officeId);
  res.json(index);
});

// GET /api/swarm/files/:path — Read a workspace file
workspaceRoutes.get('/{*path}', async (req, res) => {
  const officeId = getOfficeId(req);
  if (!officeId) {
    return res.status(400).json({ error: 'No active shift' });
  }

  const filePath = (req.params as Record<string, string | string[]>).path;
  const resolved = Array.isArray(filePath) ? filePath.join('/') : filePath;
  if (!resolved) {
    return res.status(400).json({ error: 'Missing file path' });
  }

  const result = await readFile(officeId, resolved);
  if (!result) {
    return res.status(404).json({ error: 'File not found or invalid path' });
  }

  res.json(result);
});

// POST /api/swarm/files/:path/append — Append to a workspace file
workspaceRoutes.post('/{*path}', async (req, res) => {
  const sessionId = req.headers['x-session-id'] as string | undefined;
  if (!sessionId || !getMember(sessionId)) {
    return res.status(401).json({ error: 'Invalid or missing X-Session-Id header' });
  }

  const officeId = getOfficeId(req);
  if (!officeId) {
    return res.status(400).json({ error: 'No active shift' });
  }

  const rawPath = (req.params as Record<string, string | string[]>).path;
  const resolved = Array.isArray(rawPath) ? rawPath.join('/') : rawPath;
  if (!resolved) {
    return res.status(400).json({ error: 'Missing file path' });
  }

  const { content, separator } = req.body;
  if (content === undefined || typeof content !== 'string') {
    return res.status(400).json({ error: "Missing or invalid 'content' field" });
  }

  const member = getMember(sessionId)!;
  const author = member.agentName || 'Anonymous';

  try {
    const entry = await appendFile(officeId, resolved, content, author, separator);
    res.json(entry);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

// PUT /api/swarm/files/:path — Write (create/update) a workspace file
workspaceRoutes.put('/{*path}', async (req, res) => {
  const sessionId = req.headers['x-session-id'] as string | undefined;
  if (!sessionId || !getMember(sessionId)) {
    return res.status(401).json({ error: 'Invalid or missing X-Session-Id header' });
  }

  const officeId = getOfficeId(req);
  if (!officeId) {
    return res.status(400).json({ error: 'No active shift' });
  }

  const filePath = (req.params as Record<string, string | string[]>).path;
  const resolved = Array.isArray(filePath) ? filePath.join('/') : filePath;
  if (!resolved) {
    return res.status(400).json({ error: 'Missing file path' });
  }

  const { content, description } = req.body;
  if (content === undefined || typeof content !== 'string') {
    return res.status(400).json({ error: "Missing or invalid 'content' field" });
  }

  const member = getMember(sessionId)!;
  const author = member.agentName || 'Anonymous';

  try {
    const entry = await writeFile(officeId, resolved, content, author, description);
    res.json(entry);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

// DELETE /api/swarm/files/:path — Delete a workspace file
workspaceRoutes.delete('/{*path}', async (req, res) => {
  const sessionId = req.headers['x-session-id'] as string | undefined;
  if (!sessionId || !getMember(sessionId)) {
    return res.status(401).json({ error: 'Invalid or missing X-Session-Id header' });
  }

  const officeId = getOfficeId(req);
  if (!officeId) {
    return res.status(400).json({ error: 'No active shift' });
  }

  const filePath = (req.params as Record<string, string | string[]>).path;
  const resolved = Array.isArray(filePath) ? filePath.join('/') : filePath;
  if (!resolved) {
    return res.status(400).json({ error: 'Missing file path' });
  }

  const deleted = await deleteFile(officeId, resolved);
  if (!deleted) {
    return res.status(404).json({ error: 'File not found or invalid path' });
  }

  res.json({ deleted: true });
});
