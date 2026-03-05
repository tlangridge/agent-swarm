import type { IPty } from 'node-pty';
import { sessions } from '../pty-manager.js';

const CHUNK_SIZE = 32;
const CHUNK_DELAY = 12;     // ms between chunks
const PRE_CR_DELAY = 150;   // ms pause before sending \r
const POST_CR_SETTLE = 100; // ms pause after \r before next queued message
const INSURANCE_TIMEOUT = 400; // ms to wait for output before retrying \r

interface RegisteredSession {
  pty: IPty;
  queue: Promise<void>;
}

const registered = new Map<string, RegisteredSession>();

export function registerSession(sessionId: string, pty: IPty): void {
  registered.set(sessionId, { pty, queue: Promise.resolve() });
}

export function unregisterSession(sessionId: string): void {
  registered.delete(sessionId);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Write text in small chunks to avoid triggering paste-bracket detection
 * in CLI tools like Claude Code.
 */
function writeChunked(pty: IPty, text: string): Promise<void> {
  return new Promise((resolve) => {
    if (text.length <= CHUNK_SIZE) {
      pty.write(text);
      resolve();
      return;
    }
    let offset = 0;
    function next() {
      const chunk = text.slice(offset, offset + CHUNK_SIZE);
      pty.write(chunk);
      offset += CHUNK_SIZE;
      if (offset >= text.length) resolve();
      else setTimeout(next, CHUNK_DELAY);
    }
    next();
  });
}

/**
 * Send \r and monitor for output. If no output is received within
 * INSURANCE_TIMEOUT ms, send a second \r as insurance.
 */
function sendCrWithInsurance(pty: IPty): Promise<void> {
  return new Promise((resolve) => {
    let gotOutput = false;
    const disposable = pty.onData(() => {
      gotOutput = true;
    });

    pty.write('\r');

    setTimeout(() => {
      disposable.dispose();
      if (!gotOutput) {
        // No output detected — the \r may have been swallowed. Retry.
        pty.write('\r');
      }
      resolve();
    }, INSURANCE_TIMEOUT);
  });
}

/**
 * Queue a message for injection into a session's PTY.
 * Messages to the same session are serialized (no interleaving).
 * The text is chunked, then \r is sent with insurance retry.
 */
export function injectMessage(sessionId: string, text: string): Promise<void> {
  const entry = registered.get(sessionId);
  if (!entry) {
    console.warn(`pty-writer: session ${sessionId} not registered, skipping inject`);
    return Promise.resolve();
  }

  const job = entry.queue.then(async () => {
    // Re-check in case session was unregistered while queued
    const current = registered.get(sessionId);
    if (!current) return;

    await writeChunked(current.pty, text);
    await delay(PRE_CR_DELAY);
    await sendCrWithInsurance(current.pty);
    // Track message injection for context health monitoring
    const sessionObj = sessions.get(sessionId);
    if (sessionObj) sessionObj.messageInjectionCount++;
    await delay(POST_CR_SETTLE);
  });

  entry.queue = job.catch(() => {});
  return job;
}
