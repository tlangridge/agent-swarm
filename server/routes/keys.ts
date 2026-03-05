import { Router } from 'express';
import {
  loadGlobalKeys,
  saveGlobalKeys,
  loadOfficeKeys,
  saveOfficeKeys,
  maskKey,
  getResolvedKeysWithSource,
} from '../services/key-store.js';

export const keyRoutes = Router();

// --- Global keys ---

// GET /api/keys/global — list global keys (masked)
keyRoutes.get('/global', (_req, res) => {
  const keys = loadGlobalKeys();
  const masked: Record<string, string> = {};
  for (const [name, value] of Object.entries(keys)) {
    masked[name] = maskKey(value);
  }
  res.json({ keys: masked });
});

// PUT /api/keys/global — set global keys (partial merge)
keyRoutes.put('/global', (req, res) => {
  const incoming = req.body as Record<string, string>;
  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({ error: 'Body must be a JSON object of key-value pairs' });
  }

  const existing = loadGlobalKeys();
  for (const [name, value] of Object.entries(incoming)) {
    if (typeof value === 'string' && value.length > 0) {
      existing[name] = value;
    }
  }
  saveGlobalKeys(existing);

  // Return masked version
  const masked: Record<string, string> = {};
  for (const [name, value] of Object.entries(existing)) {
    masked[name] = maskKey(value);
  }
  res.json({ keys: masked });
});

// DELETE /api/keys/global/:keyName — remove a single global key
keyRoutes.delete('/global/:keyName', (req, res) => {
  const keys = loadGlobalKeys();
  const { keyName } = req.params;

  if (!(keyName in keys)) {
    return res.status(404).json({ error: `Key "${keyName}" not found` });
  }

  delete keys[keyName];
  saveGlobalKeys(keys);
  res.json({ deleted: true, keyName });
});

// --- Office keys ---

// GET /api/keys/offices/:officeId — list office keys (masked)
keyRoutes.get('/offices/:officeId', (req, res) => {
  const keys = loadOfficeKeys(req.params.officeId);
  const masked: Record<string, string> = {};
  for (const [name, value] of Object.entries(keys)) {
    masked[name] = maskKey(value);
  }
  res.json({ keys: masked });
});

// PUT /api/keys/offices/:officeId — set office keys (partial merge)
keyRoutes.put('/offices/:officeId', (req, res) => {
  const incoming = req.body as Record<string, string>;
  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({ error: 'Body must be a JSON object of key-value pairs' });
  }

  const existing = loadOfficeKeys(req.params.officeId);
  for (const [name, value] of Object.entries(incoming)) {
    if (typeof value === 'string' && value.length > 0) {
      existing[name] = value;
    }
  }
  saveOfficeKeys(req.params.officeId, existing);

  const masked: Record<string, string> = {};
  for (const [name, value] of Object.entries(existing)) {
    masked[name] = maskKey(value);
  }
  res.json({ keys: masked });
});

// DELETE /api/keys/offices/:officeId/:keyName — remove a single office key
keyRoutes.delete('/offices/:officeId/:keyName', (req, res) => {
  const keys = loadOfficeKeys(req.params.officeId);
  const { keyName } = req.params;

  if (!(keyName in keys)) {
    return res.status(404).json({ error: `Key "${keyName}" not found` });
  }

  delete keys[keyName];
  saveOfficeKeys(req.params.officeId, keys);
  res.json({ deleted: true, keyName });
});

// --- Resolved preview ---

// GET /api/keys/resolved/:officeId — preview resolved keys with source tier (masked)
keyRoutes.get('/resolved/:officeId', (req, res) => {
  const resolved = getResolvedKeysWithSource(req.params.officeId);
  res.json({ keys: resolved });
});
