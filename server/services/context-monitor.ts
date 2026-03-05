import { sessions } from '../pty-manager.js';
import { getMember, getMembersByOffice, getLeadSessionIdForOffice } from './swarm-registry.js';
import { injectMessage } from './pty-writer.js';

// Track state to avoid duplicate warnings
const warnedSessions = new Set<string>();       // warned at "low" threshold
const criticalWarnedSessions = new Set<string>(); // warned at "critical" threshold
const compactionNotified = new Set<string>();    // notified on first compaction
const monitors = new Map<string, ReturnType<typeof setInterval>>();

// Minimum session age before context health scoring kicks in (2 minutes).
// Fresh sessions produce lots of startup output that isn't real context usage.
const MIN_AGE_MS = 2 * 60 * 1000;

function stripAnsi(input: string): string {
  return input
    .replace(/\u001B\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    .replace(/\r/g, '');
}

function parseLatestCodexContextLeft(scrollback: string): number | null {
  const cleaned = stripAnsi(scrollback);
  const pattern = /(\d{1,3})%\s+(?:context\s+)?left\b/gi;
  let match: RegExpExecArray | null;
  let lastSeen: number | null = null;

  while ((match = pattern.exec(cleaned)) !== null) {
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value) && value >= 0 && value <= 100) {
      lastSeen = value;
    }
  }

  return lastSeen;
}

export function computeContextHealth(sessionId: string): number {
  const session = sessions.get(sessionId);
  if (!session) return 0;

  if (session.cliType === 'codex') {
    const reported = parseLatestCodexContextLeft(session.scrollback);
    if (reported !== null) return reported;
  }

  // Grace period: brand-new sessions are always "healthy"
  const ageMs = Date.now() - session.createdAt.getTime();
  if (ageMs < MIN_AGE_MS) return 100;

  // Compaction is a signal of heavy usage but not catastrophic
  const compactionPenalty = Math.min(40, session.compactionCount * 20);

  // Heuristic scoring
  const outputPenalty = Math.min(50, (session.totalOutputBytes / (400 * 1024)) * 50);
  const ageHours = ageMs / 3_600_000;
  const agePenalty = Math.min(30, ageHours * 5);
  const msgPenalty = Math.min(20, session.messageInjectionCount * 2);

  return Math.max(0, Math.round(100 - outputPenalty - agePenalty - msgPenalty - compactionPenalty));
}

export function onCompaction(sessionId: string, count: number): void {
  const member = getMember(sessionId);
  if (!member) return;

  // Only notify once per session (first compaction)
  if (compactionNotified.has(sessionId)) return;
  compactionNotified.add(sessionId);

  // Warn the agent directly
  injectMessage(sessionId,
    `[SWARM SYSTEM]: Your context window has been compacted (${count}x). ` +
    `This means you're using significant context. To extend your session:\n` +
    `- Delegate more work to subagents (Task tool) instead of doing it in your main context\n` +
    `- Avoid reading large files directly — have a subagent summarize them\n` +
    `- If you're too degraded to continue, tell the lead you need a fresh start`
  );

  // Notify the lead (if this isn't the lead)
  const leadId = getLeadSessionIdForOffice(member.officeId);
  if (leadId && leadId !== sessionId) {
    injectMessage(leadId,
      `[SWARM SYSTEM]: ${member.agentName} has compacted their context (${count}x). ` +
      `They can continue working but may lose effectiveness over time. ` +
      `Consider reassigning heavy tasks if they slow down.`
    );
  }
}

export function startContextMonitor(officeId: string): void {
  stopContextMonitor(officeId);

  const timer = setInterval(() => {
    const members = getMembersByOffice(officeId);
    const leadId = getLeadSessionIdForOffice(officeId);

    for (const member of members) {
      const health = computeContextHealth(member.sessionId);

      if (health < 20 && !criticalWarnedSessions.has(member.sessionId)) {
        // Critical — warn the agent directly and notify lead
        criticalWarnedSessions.add(member.sessionId);
        injectMessage(member.sessionId,
          `[SWARM SYSTEM]: Your context health is critically low (${health}/100). ` +
          `You should wrap up your current task and delegate remaining work. ` +
          `If you can't continue effectively, tell the lead you need to be rotated.`
        );
        if (leadId && leadId !== member.sessionId) {
          injectMessage(leadId,
            `[SWARM SYSTEM]: ${member.agentName}'s context health is critically low (${health}/100). ` +
            `Consider reassigning their remaining work to another agent.`
          );
        }
      } else if (health < 40 && !warnedSessions.has(member.sessionId)) {
        // Low — warn the agent to conserve context
        warnedSessions.add(member.sessionId);
        injectMessage(member.sessionId,
          `[SWARM SYSTEM]: Your context health is getting low (${health}/100). ` +
          `Conserve context by delegating more to subagents. ` +
          `Avoid reading files or running commands directly in your main context.`
        );
        if (leadId && leadId !== member.sessionId) {
          injectMessage(leadId,
            `[SWARM SYSTEM]: ${member.agentName}'s context health is low (${health}/100). ` +
            `They may need work reassigned soon.`
          );
        }
      }
    }
  }, 30_000);

  monitors.set(officeId, timer);
}

export function stopContextMonitor(officeId: string): void {
  const timer = monitors.get(officeId);
  if (timer) {
    clearInterval(timer);
    monitors.delete(officeId);
  }
  // Clean up tracked state for agents in this office
  const members = getMembersByOffice(officeId);
  for (const m of members) {
    warnedSessions.delete(m.sessionId);
    criticalWarnedSessions.delete(m.sessionId);
    compactionNotified.delete(m.sessionId);
  }
}
