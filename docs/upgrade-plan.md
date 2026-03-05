# Agent Swarm Upgrade Plan

**Date:** 2026-03-04
**Source:** [Paperclip Analysis](./paperclip-analysis.md)
**Status:** Research complete — implementation not yet started

---

## Table of Contents

1. [Upgrade 1: Atomic Task Checkout with Run Tracking](#upgrade-1-atomic-task-checkout-with-run-tracking)
2. [Upgrade 2: Cost and Token Tracking Per Agent](#upgrade-2-cost-and-token-tracking-per-agent)
3. [Upgrade 3: Skills Injection via `--add-dir`](#upgrade-3-skills-injection-via---add-dir)
4. [Priority and Sequencing](#priority-and-sequencing)

---

## Upgrade 1: Atomic Task Checkout with Run Tracking

### Problem

The current task system has a race condition: when an agent calls `POST /api/swarm/tasks/:id/pick`, the endpoint reads the task from disk, updates it, and writes it back. Two agents could read the same task in the `open` state simultaneously, both succeed at picking it, and end up both working on it. There is also no mechanism to automatically release a task if the session that holds it dies.

### Solution

- **Atomic checkout locks** tied to session IDs with fast in-memory conflict detection
- **409 Conflict** responses when a second agent attempts to pick an already-locked task
- **Auto-release** when a session exits (PTY process dies)
- **Stale lock detection** with liveness annotations for the dashboard
- **UI indicators** showing which agent has a task checked out and for how long

### File-by-File Changes

#### 1.1 `server/services/task-board.ts` — Core Lock Map + Checkout Fields

**New fields on `TaskItem` interface:**

```typescript
export interface TaskItem {
  // ... existing fields ...
  checkoutSessionId?: string;    // Session ID holding the lock
  checkoutAgentName?: string;    // Friendly name for display
  checkedOutAt?: string;         // ISO timestamp of checkout
}
```

**New in-memory lock map:**

```typescript
interface CheckoutLock {
  taskId: string;
  sessionId: string;
  agentName: string;
  lockedAt: number;  // Date.now() for fast staleness math
}

// taskId -> CheckoutLock
const checkoutLocks = new Map<string, CheckoutLock>();
```

**New exported functions:**

```typescript
/** Atomically checkout a task. Returns the lock on success, or conflict info. */
export async function checkoutTask(
  taskId: string,
  sessionId: string,
  agentName: string,
): Promise<{ task: TaskItem; lock: CheckoutLock } | { conflict: CheckoutLock }>;

/** Release a checkout lock. Returns true if released. */
export async function releaseCheckout(taskId: string, sessionId?: string): Promise<boolean>;

/** Release all checkouts held by a given session (for session exit). */
export async function releaseSessionCheckouts(sessionId: string): Promise<string[]>;

/** Get the lock for a task (if any). */
export function getCheckoutLock(taskId: string): CheckoutLock | undefined;

/** Get all active locks. */
export function getAllCheckoutLocks(): CheckoutLock[];

/** Rehydrate lock map from disk on startup. */
export async function rehydrateCheckoutLocks(): Promise<void>;
```

**`checkoutTask` flow:**

Since Node.js is single-threaded, the in-memory Map check + set is inherently atomic:

1. Check `checkoutLocks.has(taskId)` — if locked by a different session, return `{ conflict }`.
2. If locked by the same session, return the existing lock (idempotent).
3. Read the task from disk. If not found or not `open`, return error.
4. Check dependency satisfaction (reuse `areDependenciesMet`).
5. Set the in-memory lock.
6. Update the task on disk with `checkoutSessionId`, `checkoutAgentName`, `checkedOutAt`, `assignedTo`, `status: 'in-progress'`.
7. Return `{ task, lock }`.

**`releaseCheckout` flow:**

1. Remove from `checkoutLocks` map.
2. Clear checkout fields on disk.
3. If task is still `in-progress`, reset to `open` and clear `assignedTo`.

**`releaseSessionCheckouts` flow:**

Iterate over all entries in `checkoutLocks`, collect those matching `sessionId`, call `releaseCheckout` for each. Return the list of released task IDs.

**`rehydrateCheckoutLocks` flow:**

On server startup, scan all task JSON files. For any task with a `checkoutSessionId` set, populate the in-memory map. Cross-reference with live sessions and release orphaned locks.

**Stale lock detection:**

```typescript
const STALE_LOCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

export function isLockStale(lock: CheckoutLock): boolean {
  return Date.now() - lock.lockedAt > STALE_LOCK_THRESHOLD_MS;
}
```

**Update `getReadyTasks`** to exclude checked-out tasks:

```typescript
const openTasks = allTasks.filter(t => t.status === 'open' && !checkoutLocks.has(t.id));
```

#### 1.2 `server/routes/tasks.ts` — Endpoint Changes

**`POST /:id/pick` — Replace with atomic checkout:**

```typescript
taskRoutes.post('/:id/pick', async (req, res) => {
  const senderSessionId = req.headers['x-session-id'] as string | undefined;
  if (!senderSessionId || !getMember(senderSessionId)) {
    return res.status(401).json({ error: 'Invalid or missing X-Session-Id header' });
  }

  if (!canAcceptTask(senderSessionId)) {
    return res.status(429).json({ error: 'Agent circuit breaker is open...' });
  }

  const sender = getMember(senderSessionId)!;
  const result = await checkoutTask(
    req.params.id, senderSessionId, sender.agentName || 'Anonymous',
  );

  if ('conflict' in result) {
    return res.status(409).json({
      error: 'Task is already checked out',
      checkedOutBy: result.conflict.agentName,
      checkoutSessionId: result.conflict.sessionId,
      checkedOutAt: new Date(result.conflict.lockedAt).toISOString(),
    });
  }

  res.json(result.task);
});
```

**`POST /:id/done` — Release lock on completion:**

After the existing completion logic, add:
```typescript
await releaseCheckout(req.params.id, senderSessionId);
```

**`POST /:id/fail` — Release lock on failure:**

After marking the task `blocked`:
```typescript
await releaseCheckout(req.params.id, senderSessionId);
```

**`PUT /:id` — Guard against reassignment of locked tasks:**

When the dashboard or another agent tries to change `assignedTo` on a task that has an active checkout lock held by a different session, return 409. Dashboard (`X-Dashboard: true`) is allowed to force-override.

**New endpoint `POST /:id/release` — Manual lock release:**

```typescript
taskRoutes.post('/:id/release', async (req, res) => {
  const isDashboard = req.headers['x-dashboard'] === 'true';
  const senderSessionId = req.headers['x-session-id'] as string | undefined;

  // Only dashboard or the lead can force-release
  if (!isDashboard && senderSessionId) {
    const sender = getMember(senderSessionId);
    if (sender?.role !== 'lead') {
      return res.status(403).json({ error: 'Only the lead or dashboard can force-release' });
    }
  }

  const released = await releaseCheckout(req.params.id);
  if (!released) return res.status(404).json({ error: 'No active checkout on this task' });

  const task = await getTask(req.params.id);
  res.json({ released: true, task });
});
```

**New endpoint `GET /locks` — List all active checkout locks.**

#### 1.3 `server/ws-handler.ts` — Auto-Release on Session Exit

**In the `session.pty.onExit` handler:**

Add checkout release before `sessions.delete` and `removeMember`:

```typescript
session.pty.onExit(({ exitCode }) => {
  // Release any task checkout locks held by this session
  releaseSessionCheckouts(sessionId).then(releasedTaskIds => {
    if (releasedTaskIds.length > 0) {
      console.log(`Auto-released ${releasedTaskIds.length} checkout(s) for exited session ${sessionId}`);
      const member = getMember(sessionId);
      const leadId = getLeadSessionId(member?.officeId || undefined);
      if (leadId && leadId !== sessionId) {
        injectMessage(leadId,
          `[SWARM SYSTEM]: ${member?.agentName || sessionId} exited. ` +
          `Auto-released checkout locks on task(s): ${releasedTaskIds.join(', ')}. ` +
          `These tasks are available for reassignment.`
        );
      }
    }
  }).catch(err => console.error('Failed to release session checkouts:', err));

  handleSlotExit(sessionId, exitCode).catch(err => { ... });
  // ... rest of existing handler
});
```

Also add to the `case 'kill':` handler.

#### 1.4 `server/index.ts` — Startup Rehydration

After session restoration and before accepting connections:

```typescript
import { rehydrateCheckoutLocks } from './services/task-board.js';
await rehydrateCheckoutLocks();
```

#### 1.5 `client/src/types.ts` — Interface Updates

```typescript
export interface TaskItem {
  // ... existing fields ...
  checkoutSessionId?: string;
  checkoutAgentName?: string;
  checkedOutAt?: string;
  checkoutLive?: boolean;    // server-computed annotation
  checkoutStale?: boolean;   // server-computed annotation
}
```

#### 1.6 `client/src/components/PipelinePanel.tsx` — Checkout Status in Task Cards

Add lock indicator with agent name, stale/dead badges, and a "Release Lock" button for stale or dead locks:

```tsx
{task.checkoutSessionId && (
  <span className={`pipeline-card-checkout ${task.checkoutStale ? 'stale' : ''}`}>
    🔒 {task.checkoutAgentName}
    {task.checkoutStale && <span className="pipeline-checkout-stale">STALE</span>}
    {task.checkoutLive === false && <span className="pipeline-checkout-dead">DEAD</span>}
  </span>
)}

{task.checkoutSessionId && (task.checkoutStale || task.checkoutLive === false) && (
  <button className="pipeline-release-btn"
    onClick={() => fetch(`/api/swarm/tasks/${task.id}/release`, {
      method: 'POST', headers: { 'X-Dashboard': 'true' },
    })}
  >
    🔓 Release Lock
  </button>
)}
```

#### 1.7 `cli/swarm` — 409 Error Handling

Update `cmd_task_pick` to detect HTTP 409 and print a clear message:

```bash
cmd_task_pick() {
  local id="${1:-}"
  [ -z "$id" ] && { echo "Usage: swarm task pick <id>" >&2; exit 1; }
  local response http_code
  response=$(require_sid; curl -s -w "\n%{http_code}" -X POST \
    -H "Content-Type: application/json" -H "X-Session-Id: $SID" \
    -d '{}' "$API/api/swarm/tasks/$id/pick")
  http_code=$(echo "$response" | tail -1)
  local body=$(echo "$response" | sed '$d')

  if [ "$http_code" = "409" ]; then
    echo "CONFLICT: Task $id is already checked out by another agent." >&2
    echo "Use 'swarm tasks --ready' to find available tasks." >&2
    exit 1
  fi
  echo "$body"
}
```

#### 1.8 `server/services/swarm-prompts.ts` — Update Agent Instructions

Update step 5 in the worker prompt to mention atomic locking:
```
5. Pick a task: `swarm task pick <id>` (atomically locks the task to your session — if you get 409 CONFLICT, pick another with `swarm tasks --ready`)
```

### Implementation Sequence

1. Core locking infrastructure (`task-board.ts`)
2. Route changes (`tasks.ts`)
3. Session lifecycle auto-release (`ws-handler.ts`)
4. Startup rehydration (`server/index.ts`)
5. Client types and UI (`types.ts`, `PipelinePanel.tsx`, `AgentCard.tsx`, `App.css`)
6. CLI and prompts (`cli/swarm`, `swarm-prompts.ts`)

### Potential Challenges

| Challenge | Mitigation |
|-----------|------------|
| **Clustered server** — In-memory Map won't work with multiple processes | Currently single-process; if clustered later, switch to Redis SETNX |
| **Race between onExit and respawn** — Task reverts to `open`, another agent could grab it before respawn | Correct behavior — crashed agent's work may be invalid |
| **Dashboard force-override** — Should inject warning to agent whose lock was revoked | Add `injectMessage` in the release handler |
| **Task state after release** — Only reset `in-progress` tasks to `open`; don't touch `done` or `blocked` | Guard in `releaseCheckout` |
| **Disk/memory consistency** — Every map write must be followed by disk write | Rollback in-memory lock on disk write failure |

---

## Upgrade 2: Cost and Token Tracking Per Agent

### Problem

Zero visibility into per-agent API costs. A 10-agent shift could burn significant credits with no monitoring.

### Solution

Parse "Total cost: $X.XX" from Claude Code terminal output, track per-agent costs in memory, add optional per-slot budgets with threshold warnings, display costs in the dashboard, include cost summary in shift close reports.

### File-by-File Changes

#### 2.1 `server/ws-handler.ts` — Hook into `accumScrollback`

The `accumScrollback` function (line 123) processes every byte of PTY output and already detects compaction events. Cost parsing fits the same pattern:

```typescript
function accumScrollback(session: PtySession, data: string): void {
  session.scrollback += data;
  session.totalOutputBytes += data.length;
  // ... existing truncation and compaction detection ...

  // NEW: Detect cost updates from Claude Code output
  parseCostFromOutput(session.id, data);

  schedulePersistState();
}
```

#### 2.2 `server/services/cost-tracker.ts` — New Service (Core)

**Schema:**

```typescript
export interface CostRecord {
  sessionId: string;
  agentName: string;
  officeId: string;
  totalCost: number;             // dollars (cumulative from Claude's "Total cost")
  lastReportedCost: number;      // for dedup
  costUpdates: number;           // how many cost lines parsed
  firstCostAt: string | null;
  lastCostAt: string | null;
  budgetCents: number | null;    // per-slot budget (null = unlimited)
  budgetWarned80: boolean;
  budgetWarned95: boolean;
  budgetExceeded: boolean;
}

export interface OfficeCostSummary {
  officeId: string;
  totalCost: number;
  agentCosts: Array<{
    agentName: string;
    sessionId: string;
    totalCost: number;
    budgetCents: number | null;
    budgetPercent: number | null;
  }>;
  generatedAt: string;
}
```

**Storage:** In-memory `Map<string, CostRecord>` keyed by sessionId.

**Key functions:**

```typescript
export function parseCostFromOutput(sessionId: string, data: string): void;
export function initCostTracking(sessionId: string, agentName: string, officeId: string, budgetCents?: number | null): void;
export function removeCostTracking(sessionId: string): CostRecord | null;
export function getCostRecord(sessionId: string): CostRecord | null;
export function getOfficeCostSummary(officeId: string): OfficeCostSummary;
export function getGlobalCostSummary(): { totalCost: number; records: CostRecord[] };
export function setSessionBudget(sessionId: string, budgetCents: number | null): void;
```

**Parsing logic:**

Claude Code's "Total cost" is cumulative per session. The parser uses a per-session line buffer to handle data split across PTY chunks:

```typescript
const lineBuffers = new Map<string, string>();

const TOTAL_COST_RE = /Total cost:\s*\$([0-9]+(?:\.[0-9]+)?)/;
const TURN_COST_RE = /(?:Cost|Session cost):\s*\$([0-9]+(?:\.[0-9]+)?)/;

export function parseCostFromOutput(sessionId: string, data: string): void {
  const record = costRecords.get(sessionId);
  if (!record) return;

  const cleaned = data.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '');  // strip ANSI
  const buffer = (lineBuffers.get(sessionId) || '') + cleaned;
  const lines = buffer.split('\n');
  lineBuffers.set(sessionId, lines.pop() || '');  // keep incomplete tail

  for (const line of lines) {
    const match = line.match(TOTAL_COST_RE) || line.match(TURN_COST_RE);
    if (match) {
      const cost = parseFloat(match[1]);
      if (!isNaN(cost) && cost >= record.totalCost) {
        record.totalCost = cost;
        record.lastReportedCost = cost;
        record.costUpdates++;
        record.lastCostAt = new Date().toISOString();
        if (!record.firstCostAt) record.firstCostAt = record.lastCostAt;
        checkBudgetThresholds(sessionId, record);
        emitCostUpdate(record);
      }
    }
  }
}
```

#### 2.3 Budget Warning System (within `cost-tracker.ts`)

Follows the exact pattern from `context-monitor.ts` — threshold-based warnings, `injectMessage` calls, dedup with boolean flags, notify both agent and lead:

| Level | Threshold | Action |
|-------|-----------|--------|
| Warning | 80% of budget | Warn agent, notify lead |
| Critical | 95% of budget | Urgent warn, alert lead |
| Exceeded | 100% of budget | Alert both, fire webhook |

```typescript
function checkBudgetThresholds(sessionId: string, record: CostRecord): void {
  if (!record.budgetCents) return;
  const costCents = Math.round(record.totalCost * 100);
  const percent = costCents / record.budgetCents;

  if (percent >= 1.0 && !record.budgetExceeded) {
    record.budgetExceeded = true;
    injectMessage(sessionId,
      `[SWARM SYSTEM]: BUDGET EXCEEDED. You have spent $${record.totalCost.toFixed(2)} ` +
      `(budget: $${(record.budgetCents / 100).toFixed(2)}). Wrap up immediately.`
    );
    // Notify lead, fire webhook...
  }
  // ... similar for 95% and 80% thresholds
}
```

#### 2.4 Schema Extensions

**`server/services/office-store.ts` — Add budget fields:**

```typescript
export interface OfficeSlot {
  // ... existing fields ...
  budgetCents?: number;          // per-slot cost budget in cents
}

export interface Office {
  // ... existing fields ...
  totalBudgetCents?: number;     // total office cost budget in cents
}
```

Mirror in `client/src/types.ts`.

#### 2.5 `server/services/activity-parser.ts` — Enrich `AgentStructuredStatus`

```typescript
export interface AgentStructuredStatus {
  // ... existing fields ...
  totalCost: number;
  budgetCents: number | null;
  budgetPercent: number | null;
}
```

In `getStructuredStatus`, populate from `getCostRecord(member.sessionId)`.

#### 2.6 Dashboard UI — `AgentCard.tsx`

Add a cost row with dollar amount and optional budget progress bar:

```tsx
{structuredStatus && structuredStatus.totalCost > 0 && (
  <div className="agent-card-cost">
    <span className="agent-card-cost-amount">
      ${structuredStatus.totalCost.toFixed(2)}
    </span>
    {structuredStatus.budgetCents != null && (
      <div className="agent-card-budget-bar">
        <div className="agent-card-budget-fill"
          style={{
            width: `${Math.min(100, structuredStatus.budgetPercent || 0)}%`,
            backgroundColor: budgetPercent >= 100 ? '#f7768e'
              : budgetPercent >= 95 ? '#ff9e64'
              : budgetPercent >= 80 ? '#e0af68'
              : '#9ece6a',
          }}
        />
      </div>
    )}
  </div>
)}
```

#### 2.7 `ShiftStatusBar.tsx` — Total Shift Cost

Add a `totalShiftCost` prop and display alongside shift info:

```tsx
{totalShiftCost > 0 && (
  <span className="shift-cost-badge">${totalShiftCost.toFixed(2)}</span>
)}
```

#### 2.8 REST Endpoint — `GET /api/swarm/costs`

```typescript
swarmRoutes.get('/costs', (req, res) => {
  const officeId = req.query.officeId as string | undefined;
  if (officeId) {
    res.json(getOfficeCostSummary(officeId));
  } else {
    res.json(getGlobalCostSummary());
  }
});
```

#### 2.9 Shift Close Report — `shift-manager.ts`

In `generateCloseDocument`, add a cost summary table after the Team Roster:

```typescript
const costSummary = getOfficeCostSummary(shift.officeId);
if (costSummary.totalCost > 0) {
  lines.push('## Cost Summary', '');
  lines.push(`**Total shift cost: $${costSummary.totalCost.toFixed(2)}**`, '');
  lines.push('| Agent | Cost | Budget | % Used |');
  lines.push('|-------|------|--------|--------|');
  for (const ac of costSummary.agentCosts) {
    lines.push(`| ${ac.agentName} | $${ac.totalCost.toFixed(2)} | ... |`);
  }
}
```

#### 2.10 WebSocket Broadcast

Listen on `swarmEvents` for `cost:update` and broadcast to browser clients:

```typescript
swarmEvents.on('cost:update', (data) => {
  broadcastToOffice(data.officeId, { type: 'cost:update', ...data });
});
```

#### 2.11 Integration Wiring

- **`shift-manager.ts` `badgeIn()`**: Call `initCostTracking(sessionId, agent.name, office.id, slot.budgetCents)` after activation.
- **`ws-handler.ts` `onExit`**: Call `removeCostTracking(sessionId)` before deleting session.
- **`webhooks.ts`**: Add `'cost:exceeded'` and `'cost:warning'` event types.

### Implementation Sequence

1. Schema extensions (office-store.ts, client types.ts)
2. `cost-tracker.ts` service (new file)
3. `accumScrollback` hook (ws-handler.ts)
4. Session lifecycle wiring (shift-manager.ts, ws-handler.ts)
5. Activity parser enrichment (activity-parser.ts)
6. REST endpoint (swarm.ts)
7. WebSocket broadcast (ws-handler.ts)
8. Client types (types.ts)
9. AgentCard cost display + CSS
10. ShiftStatusBar total
11. Shift close report (shift-manager.ts)
12. Webhook events (webhooks.ts)

### Potential Challenges

| Challenge | Mitigation |
|-----------|------------|
| **ANSI codes in cost lines** | Strip ANSI before regex matching |
| **Chunk boundary splitting** | Per-session line buffer; clean up on session end |
| **Cost deduplication** | `>= record.totalCost` guard; Claude's total is cumulative |
| **Respawned sessions** | Carry over previous session's accumulated cost |
| **Non-Claude agents** | Gracefully handle (init to $0, never updated, don't show in UI) |
| **Server restart** | In-memory only (matches context-monitor pattern); persist later if needed |

---

## Upgrade 3: Skills Injection via `--add-dir`

### Problem

System prompts via `--append-system-prompt` are growing monolithic. The `skills` field on `OfficeSlot` is unused. There's no modular way to add/remove capabilities per agent.

### Solution

Create modular skill files in a `skills/` directory at project root. At spawn time, assemble a temp directory with `.claude/skills/` structure containing symlinks to selected skills, pass via `--add-dir` to Claude Code. Skills are version-controlled, lazy-loaded, and discoverable.

### File-by-File Changes

#### 3.1 Skills Directory Structure

```
skills/                           # project root, committed to repo
  swarm-coordination/
    SKILL.md                      # CLI reference, message format, coordination protocol
  task-management/
    SKILL.md                      # Task lifecycle, dependency mgmt, priority levels
  context-conservation/
    SKILL.md                      # Subagent delegation, context preservation
  lead-agent/
    SKILL.md                      # Lead responsibilities, delegation best practices
  worker-agent/
    SKILL.md                      # Wait-for-assignment, pick-work-verify-done cycle
  code-review/
    SKILL.md                      # Structured review checklist
  git-worktree/
    SKILL.md                      # Worktree isolation protocol, branch conventions
  shift-protocol/
    SKILL.md                      # Shift lifecycle, close reports, handoff
```

Each `SKILL.md` has YAML frontmatter:

```yaml
---
name: swarm-coordination
description: Multi-agent office coordination using the swarm CLI. Use when communicating with other agents, checking team status, or coordinating work.
user-invocable: false
---
```

Content is extracted from the existing monolithic prompts in `swarm-prompts.ts`.

#### 3.2 `server/services/skill-registry.ts` — New Service

Discovers available skills and maps roles to default skill sets.

```typescript
export interface SkillMeta {
  name: string;        // directory name
  description: string; // from SKILL.md frontmatter
  path: string;        // absolute path to skill directory
}

export function discoverSkills(): SkillMeta[];
export function getDefaultSkills(swarmRole: SwarmRole, functionalRole?: FunctionalRole | null): string[];
export function resolveSkillPaths(skillNames: string[]): string[];
export function listAvailableSkills(): SkillMeta[];
```

**Default role-to-skill mapping:**

```typescript
const BASE_SKILLS = ['swarm-coordination', 'task-management', 'context-conservation'];

const SWARM_ROLE_SKILLS: Record<SwarmRole, string[]> = {
  lead: [...BASE_SKILLS, 'lead-agent', 'shift-protocol'],
  worker: [...BASE_SKILLS, 'worker-agent'],
};

const FUNCTIONAL_ROLE_EXTRAS: Partial<Record<FunctionalRole, string[]>> = {
  'code-reviewer': ['code-review'],
  'developer': ['git-worktree'],
  'architect': ['git-worktree'],
  'tech-lead': ['lead-agent', 'shift-protocol'],
};
```

Final skill list = `SWARM_ROLE_SKILLS[swarmRole]` + `FUNCTIONAL_ROLE_EXTRAS[functionalRole]` + `slot.skills` (user-configured).

**Frontmatter parsing** uses a simple regex (no YAML library needed):

```typescript
function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  return {
    name: yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim(),
    description: yaml.match(/^description:\s*(.+)$/m)?.[1]?.trim(),
  };
}
```

#### 3.3 `server/services/skill-injector.ts` — New Service

Creates temp directories with `.claude/skills/` structure for `--add-dir`.

```typescript
export function createSkillDir(sessionId: string, skillNames: string[], useHardCopy?: boolean): string | null;
export function cleanupSkillDir(sessionId: string): void;
export function cleanupAllSkillDirs(): void;
```

**Flow:**

1. `fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-skills-'))` — unique temp dir per session
2. `mkdir -p <tmpdir>/.claude/skills/`
3. For each skill: `fs.symlinkSync(skillPath, <tmpdir>/.claude/skills/<name>)` (or `cpSync` for Docker)
4. Return temp dir path
5. Track in `Map<sessionId, string>` for cleanup

**Docker mode:** Use `fs.cpSync()` instead of symlinks (containers can't follow host symlinks).

#### 3.4 `server/pty-manager.ts` — Add `--add-dir` to Spawn

**Add `skillDirPath` to `PtySession` interface:**

```typescript
skillDirPath: string | null;
```

**Update `spawnSession()` signature:**

```typescript
export function spawnSession(
  // ... existing params ...
  skills?: string[],  // NEW: skill names to inject
): PtySession
```

Inside `spawnSession()`, before `getCliArgs()`:

```typescript
let skillDirPath: string | null = null;
if (cliType === 'claude') {
  const defaultSkills = getDefaultSkills(swarmRole, functionalRole);
  const allSkills = [...new Set([...defaultSkills, ...(skills || [])])];
  skillDirPath = createSkillDir(id, allSkills);
}
```

**Update `getCliArgs()` — add `--add-dir`:**

After the existing `--append-system-prompt` push:

```typescript
if (skillDirPath) {
  args.push('--add-dir', skillDirPath);
}
```

**Update `killSession()` and `killAll()` — add cleanup:**

```typescript
cleanupSkillDir(sessionId);  // in killSession
cleanupAllSkillDirs();        // in killAll
```

**Docker sessions — mount as volume:**

```typescript
if (skillDirPath) {
  dockerArgs.push('-v', `${skillDirPath}:/home/agent/.swarm-skills:ro`);
  cliArgs.push('--add-dir', '/home/agent/.swarm-skills');
}
```

#### 3.5 `server/services/shift-manager.ts` — Pass Skills Through

In `badgeIn()`, `spawnSlotOnDemand()`, and `handleSlotExit()` respawn path, pass `slot.skills`:

```typescript
spawnSession(
  sessionId, cliType, 80, 24, agent,
  executionMode, permissionMode, swarmRole,
  agentProjectPath, slot.functionalRole, office.pipeline, personaCtx,
  worktreeBranch, office.id,
  slot.skills,  // NEW
);
```

#### 3.6 `server/services/swarm-prompts.ts` — Migration (Phase 2)

**Phase 1 (this implementation):** Keep existing prompts, add `--add-dir` alongside. Content is partially duplicated — Claude Code handles this gracefully.

**Phase 2 (follow-up):** Create `buildSlimSwarmPrompt()` with only:
- Identity (name, email, session ID)
- Persona block
- Work context (project path, branch)
- Pipeline stages
- One-line: "Your coordination and workflow skills are loaded automatically."

Switch Claude agents to slim prompt. Keep full `buildSwarmPrompt()` for non-Claude agents.

#### 3.7 `ws-handler.ts` — Session Exit Cleanup

In `onExit` handler:

```typescript
cleanupSkillDir(sessionId);  // Clean up BEFORE respawn creates a new one
```

#### 3.8 New API Endpoint — `GET /api/skills`

```typescript
router.get('/api/skills', (_req, res) => {
  res.json({ skills: listAvailableSkills() });
});
```

#### 3.9 UI — Skill Picker in Office Editor

Add a skill picker to each slot's expanded context panel in `OfficeEditor.tsx`:

```tsx
<div className="office-skill-picker">
  {availableSkills.map(skill => {
    const isDefault = defaultSkillsForRole.includes(skill.name);
    const isSelected = (slot.skills || []).includes(skill.name);
    return (
      <label className={`skill-chip ${isSelected ? 'selected' : ''} ${isDefault ? 'default' : ''}`}>
        <input type="checkbox" checked={isSelected || isDefault} disabled={isDefault} />
        {skill.name}
        {isDefault && <span className="skill-badge">default</span>}
      </label>
    );
  })}
</div>
```

Only show for Claude CLI type slots. Fetch available skills via `GET /api/skills` on mount.

### Implementation Sequence

1. Create `skills/` directory with 8 SKILL.md files (no code changes)
2. Create `skill-registry.ts` (discovery, role mapping)
3. Create `skill-injector.ts` (temp dir, symlinks, cleanup)
4. Add `GET /api/skills` endpoint
5. Modify `pty-manager.ts` (add `--add-dir`, session tracking, cleanup)
6. Modify `shift-manager.ts` (pass `slot.skills` through)
7. Add cleanup to `ws-handler.ts` onExit handler
8. Add startup sweep for orphaned `swarm-skills-*` temp dirs
9. UI: skill picker in `OfficeEditor.tsx` + CSS
10. Test end-to-end
11. Phase 2: slim prompt migration

### Potential Challenges

| Challenge | Mitigation |
|-----------|------------|
| **Symlinks fail on network mounts** | Fall back to `fs.cpSync()` on `EPERM` |
| **Docker can't follow host symlinks** | Use `useHardCopy: true` (copies instead of symlinks) |
| **Temp dir accumulation on crash** | Startup sweep removes orphaned `swarm-skills-*` dirs |
| **`--add-dir` + worktrees** | `--add-dir` is independent of CWD; works fine |
| **`--append-system-prompt` size** | Phase 1 is additive (some duplication); Phase 2 slims it down |
| **Non-Claude CLI types** | `cliType === 'claude'` guard; skill-injector is a no-op for others |
| **Live editing during sessions** | Claude Code has live change detection for `--add-dir` skills; symlinks make this automatic |

---

## Priority and Sequencing

### Recommended Order

| # | Upgrade | Value | Effort | Why This Order |
|---|---------|-------|--------|----------------|
| 1 | **Atomic Task Checkout** | High | Moderate | Prevents duplicate work and crash recovery — foundational for autonomous operation |
| 2 | **Cost/Token Tracking** | High | Moderate | Visibility into spend per agent/shift — critical before scaling up |
| 3 | **Skills via `--add-dir`** | High | Low-Moderate | Modular prompt system — reduces prompt bloat and enables per-agent customization |

### Dependencies

- Upgrades 1 and 2 are **independent** and can be built in parallel.
- Upgrade 3 is **independent** of 1 and 2 but benefits from being done after prompt stabilization.
- None of the upgrades require the others as a prerequisite.

### Future Upgrades (4-7)

These are documented in detail in [paperclip-analysis.md](./paperclip-analysis.md) and would be tackled after upgrades 1-3.

#### 4. Structured Transcript View

**Value:** High | **Effort:** Significant

Parse Claude Code's stream-json output into structured transcript entries: assistant text, tool calls, tool results, thinking blocks. Color-coded, searchable, much more readable than raw terminal output. Our xterm.js terminals are great for interaction but terrible for monitoring — when 10 agents are running, you can't quickly scan what each is doing.

**Implementation sketch:** Add a "transcript" view mode alongside the terminal. Parse the scrollback or stream-json output into structured entries. Show in the agent dashboard cards. This is the approach Paperclip uses as their primary agent monitoring interface.

#### 5. Approval/Governance Gates

**Value:** Medium | **Effort:** Moderate

Agents can request human approval before risky actions (deploy to production, merge to main, delete files). Approvals queue in the UI for human review. Agent blocks until resolved.

**Implementation sketch:** Add an `approvals` endpoint to the swarm API. Agents can call `swarm approve-request "<description>"`. Show in the UI with approve/reject buttons. Inject the decision back into the agent's terminal. Paperclip uses this for all agent hiring and CEO-level strategy — we'd use it for destructive operations.

#### 6. Session Persistence with `--resume`

**Value:** Medium | **Effort:** Moderate

Capture Claude Code's `session_id` from stream-json output, store on PtySession. On next heartbeat or rotation, pass `--resume <sessionId>` to reattach to the same conversation. Auto-retry with fresh session if resume fails.

**Implementation sketch:** Parse session ID from Claude Code output in our scrollback. Store per-session. On rotation, pass to the new session for potential resume. This preserves context across agent rotations instead of starting fresh.

#### 7. WebSocket → React Query Migration

**Value:** Medium | **Effort:** Significant (refactor)

WebSocket events don't update React state directly — they call `queryClient.invalidateQueries()` on specific cache keys. The actual data always comes through REST/React Query. No state sync bugs.

**Implementation sketch:** Adopt TanStack Query for data fetching. Use our existing WebSocket as an invalidation signal rather than the data transport itself. This is a significant refactor touching most components but eliminates the fragile manual WS state management that has caused stale state issues.

---

## Philosophical Context

### Paperclip vs Agent Swarm — Different Philosophies

The honest assessment: Paperclip is closest to **"a project management dashboard that triggers CLI agents on a schedule"** vs our **"live multi-agent workspace with interactive terminals."**

They optimize for **unattended batch execution** — agents wake up, do work, exit. Humans review results later. We optimize for **real-time collaborative development** — agents run persistently, humans can interact at any time, agents message each other directly.

### What Paperclip Gets Right

- **Atomic task checkout** with run-linked locks — prevents double-work, auto-releases on crash
- **The heartbeat protocol** (their SKILL.md) is a well-designed 9-step operating procedure: Identity → Approval follow-up → Get assignments → Pick work → Checkout → Understand context → Do the work → Update status → Delegate
- **Cost tracking** with auto-pause at budget ceiling
- **Goal hierarchy with ancestor context** — when an agent fetches a task, the response includes the full ancestor chain (parent tasks, project, goal, company mission). Every agent sees the "why" not just the "what." Their SKILL.md enforces: "Read ancestors to understand why this task exists."
- **Skills via `--add-dir` symlinks** — modular, lazy-loaded, discoverable

### What Paperclip Claims vs Reality

Paperclip brands itself as "the orchestration layer for zero-human companies." This is **aspirational marketing**, not reality. The code explicitly uses `"conservative defaults (human approval required)"` as a comment. Humans must:

1. Create the company and set goals
2. Approve all agent hires (agents cannot approve hires — `assertBoard(req)` middleware enforces this)
3. Sign off on CEO strategy before any work begins
4. Set and increase budgets (agents cannot modify their own budgets)
5. Terminate agents

A more honest tagline: **"Your AI workforce runs itself. You run the board."**

### Where We're Already Ahead

| Capability | Agent Swarm | Paperclip |
|-----------|-------------|-----------|
| Interactive terminals | xterm.js + node-pty, direct interaction | No terminals — fire-and-forget heartbeats |
| Real-time agent messaging | Direct REST + terminal injection, instant delivery | Async via issue comments only |
| Git worktree isolation | Per-agent worktrees with branch tracking | No worktree support |
| Shift management | Office hours, scheduled badge-in/out, close reports | No equivalent |
| Multi-provider live | Claude + Codex + Gemini side-by-side in tiling layout | Separate runs per agent type |
| Agent-to-agent coordination | Lead/worker roles, direct messaging, swarm CLI | Only through shared task/comment DB |
| Context monitoring | Health scoring, compaction detection, warnings | No context awareness |
| Cron/scheduled prompts | Per-office cron jobs injected into agents | Timer-based heartbeats (simpler) |

### Pattern Worth Noting: Goal Hierarchy with Ancestor Context

Paperclip's goal alignment architecture is worth studying even if we don't adopt it now:

```
Company Mission (on Company record)
  → Goals (company/team/agent/task level, hierarchical via parentId)
    → Projects (work containers with workspace configs)
      → Issues (actual work units with status lifecycle)
        → Sub-Issues (via parentId, infinite depth)
```

When an agent fetches a task, the response includes the full **ancestor chain** — parent tasks, project, goal, company mission. This means every agent sees the strategic context for their work. The limitation: alignment is convention-enforced via SKILL.md, not system-enforced. An agent could create an unrelated subtask and the system wouldn't prevent it.

Our equivalent would be: when `swarm task pick <id>` returns a task, include the parent task chain and the office's mission statement. This would help workers understand why they're doing something, not just what.
