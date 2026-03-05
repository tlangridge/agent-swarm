import { Router } from 'express';
import { getSavedSessionSummaries, restorePersistedState, discardSavedState } from '../services/session-persistence.js';
import { activateSessionStreaming } from '../ws-handler.js';
import { sessions } from '../pty-manager.js';

export const sessionRoutes = Router();

// GET /api/sessions/saved — return lightweight summaries of saved sessions
// If sessions are already live (e.g. page refresh), skip the picker
sessionRoutes.get('/saved', (_req, res) => {
  if (sessions.size > 0) {
    return res.json({ hasSavedSessions: false, sessions: [] });
  }
  const info = getSavedSessionSummaries();
  if (!info) {
    return res.json({ hasSavedSessions: false, sessions: [] });
  }
  res.json({
    hasSavedSessions: true,
    savedAt: info.savedAt,
    projectPath: info.projectPath,
    sessions: info.sessions,
  });
});

// POST /api/sessions/restore — restore selected sessions by ID
sessionRoutes.post('/restore', async (req, res) => {
  const { sessionIds } = req.body;
  if (!Array.isArray(sessionIds)) {
    return res.status(400).json({ error: 'sessionIds must be an array' });
  }

  const result = await restorePersistedState(
    sessionIds.length > 0 ? sessionIds : undefined,
  );
  activateSessionStreaming();

  res.json({
    restored: result.restored,
    failed: result.failed,
    releasedLocks: result.releasedLocks,
  });
});

// POST /api/sessions/discard — discard all saved sessions (start fresh)
sessionRoutes.post('/discard', async (_req, res) => {
  await discardSavedState();
  res.json({ discarded: true });
});
