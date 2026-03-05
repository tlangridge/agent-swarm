# Paperclip Analysis: Learnings for Agent Swarm

**Repo:** https://github.com/paperclipai/paperclip
**Stars:** 537 | **License:** MIT | **Created:** March 2, 2026
**Stack:** TypeScript, React 19, Express 5, PostgreSQL/PGlite, Drizzle ORM, Tailwind v4, pnpm workspaces

---

## What Paperclip Is

An orchestration platform for "AI agent companies" — agents organized with org charts, roles, budgets, governance, and task management.

Key philosophical difference: Paperclip is a **control plane** (orchestrates when agents wake and what they work on), not an execution plane. Agents run in discrete **heartbeat** invocations rather than persistent terminals.

### Their Pitch

> "The orchestration layer for zero-human companies. Everything you need to run an autonomous business: org charts, goal alignment, task ownership, budgets, agent templates."

Target users who:
- Have 20 Claude Code tabs open and can't remember who is doing what
- Use different types of agents (Codex, OpenClaw, etc.)
- Want agents working 24/7 with auditable work/costs
- Want an autonomous business, not to manage pull requests

---

## Architecture Overview

```
paperclip/
├── cli/              # CLI tool (paperclipai command) — onboard, run, doctor, configure
├── server/           # Express.js API (port 3100)
│   ├── routes/       # REST endpoints (agents, issues, costs, approvals)
│   ├── services/     # Business logic (heartbeat, issues, costs, approvals)
│   ├── adapters/     # Agent execution adapters (claude, codex, process, http)
│   ├── realtime/     # WebSocket for live events
│   └── secrets/      # Secret management (local encrypted, AWS, GCP, Vault)
├── ui/               # React frontend (Vite)
│   ├── pages/        # Dashboard, Agents, Issues, Goals, Costs, Approvals, OrgChart
│   ├── components/   # KanbanBoard, LiveRunWidget, OrgChart, CommandPalette
│   └── adapters/     # UI-side adapter parsers (transcript parsing)
├── packages/
│   ├── db/           # Drizzle ORM schema + 24 migrations, 30+ tables
│   ├── shared/       # Shared types, validators, API paths
│   └── adapters/     # claude-local, codex-local, openclaw
└── skills/           # Agent skills injected at runtime (SKILL.md files)
```

### The Heartbeat Model

```
Trigger (timer/assignment/mention/manual)
  → Server creates heartbeat_run record (queued)
  → Adapter spawns agent process (claude --print --stream-json)
  → Agent runs, calls Paperclip REST API via env vars
  → Server captures stdout, parses usage/cost, persists session state
  → Run record updated, costs logged, session persisted
```

Agents authenticate with env vars: `PAPERCLIP_AGENT_ID`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY` (short-lived JWT).

---

## High-Value Patterns We Could Adopt

### 1. Atomic Task Checkout with Run Tracking
When an agent picks up a task, it performs an atomic `checkout` that ties the lock to a specific run ID. If the run dies, the lock is automatically released. Two agents can't work on the same task — second gets 409 Conflict.

**Our gap:** Our task board has `assignedTo` but no lock mechanism. Two agents could pick up the same task, or a crash leaves a task permanently "in-progress."

### 2. Skills Injection via `--add-dir`
Instead of cramming everything into `--append-system-prompt`, they create a temp dir with `.claude/skills/` containing symlinked skill files, pass via `--add-dir`. Claude Code discovers these as registered skills — modular, lazy-loaded, discoverable.

**Our gap:** Our system prompts are growing. We have an unused `skills` field on `OfficeSlot`. Could use `--add-dir` alongside our existing `--append-system-prompt`.

### 3. Session Persistence with `--resume`
Capture Claude Code's `session_id` from stream-json output, store in DB. On next heartbeat, pass `--resume <sessionId>` to reattach. Auto-retry with fresh session if resume fails.

**Our gap:** When we rotate an agent, they start fresh. Session resume could preserve context across rotations.

### 4. Cost/Token Tracking per Agent
Track input/output/cached tokens and USD cost per run per agent. Monthly budgets with auto-pause when exceeded. Dashboard showing spend breakdown.

**Our gap:** Zero visibility into per-agent API costs. A 10-agent shift could burn significant credits with no monitoring.

### 5. WebSocket → React Query Invalidation
WebSocket events don't update React state directly — they call `queryClient.invalidateQueries()` on specific cache keys. Data always comes through REST. No state sync bugs.

**Our gap:** Our WebSocket handler manually manages state updates for sessions, members, shifts — fragile and has caused stale state issues.

### 6. Structured Transcript View
Parse Claude Code's stream-json into structured entries: assistant text, tool calls, tool results, thinking blocks. Color-coded, searchable, much better than raw terminal for monitoring.

**Our gap:** Our xterm.js terminals are great for interaction but terrible for monitoring 10 agents at once.

### 7. Approval/Governance Gates
Agents request human approval before risky actions. Approvals queue in UI for human review. Agent blocks until resolved.

**Our gap:** Autonomous agents can take destructive actions with no escalation path.

---

## Where We're Already Ahead

| Capability | Agent Swarm | Paperclip |
|-----------|-------------|-----------|
| Interactive terminals | xterm.js + node-pty, direct interaction | No terminals — fire-and-forget |
| Real-time agent messaging | Direct REST + terminal injection | Async via issue comments only |
| Git worktree isolation | Per-agent worktrees with branch tracking | No worktree support |
| Shift management | Office hours, badge-in/out, close reports | No equivalent |
| Multi-provider live | Claude + Codex + Gemini side-by-side | Separate runs per agent type |
| Agent-to-agent coordination | Lead/worker roles, direct messaging, swarm CLI | Only through shared task/comment DB |
| Context monitoring | Health scoring, compaction detection, warnings | No context awareness |
| Cron/scheduled prompts | Per-office cron jobs injected into agents | Timer-based heartbeats (simpler) |

---

## The "Zero-Human Company" Vision — Critical Assessment

### The Claim

> "The orchestration layer for zero-human companies. Everything you need to run an autonomous business."

### The Reality

Paperclip is **not** a zero-human system. It is a **human-governed autonomous company** with strong governance gates. The "zero-human" branding is aspirational — the actual architecture has hard dependencies on human intervention. That said, the engineering is substantive: agents handle daily operations autonomously within human-set guardrails.

### Where Human Intervention is MANDATORY

1. **Initial setup** — Human creates the company, sets goals, creates the first CEO agent. The bootstrap is entirely human-driven.
2. **Hiring approvals** — `requireBoardApprovalForNewAgents` defaults to `true`. Every new agent must be approved by a human. Agents cannot approve hires. The `assertBoard(req)` middleware enforces that only human users can approve.
3. **CEO strategy approval** — The CEO's initial strategic plan requires board sign-off via `approve_ceo_strategy` approval type before any work begins.
4. **Budget increases** — When an agent hits budget ceiling and auto-pauses, only a human can raise the limit. Agents cannot modify their own budgets.
5. **Agent termination** — Board can permanently terminate any agent.

### What Runs Without Humans (Steady State)

Once setup and hires are approved:
- Agents wake on schedule (heartbeats) or on-demand (assignment, @-mention)
- Agents check assignments, pick work, checkout tasks atomically, do the work, update status
- Agents create subtasks and delegate to reports
- Agents communicate via issue comments and @-mentions
- Cost tracking runs automatically with auto-pause at budget ceiling
- Session persistence carries context across heartbeats
- Execution locking prevents two agents from stomping on the same task

### Goal Alignment Architecture

```
Company Mission (description on Company record)
  → Goals (company/team/agent/task level, hierarchical via parentId)
    → Projects (work containers with workspace configs)
      → Issues (actual work units with status lifecycle)
        → Sub-Issues (via parentId, infinite depth)
```

When an agent fetches a task, the response includes full **ancestor chain** — parent tasks, project, goal, company mission. So every agent sees the "why" not just the "what." The SKILL.md enforces: "Read ancestors to understand why this task exists."

**Limitation:** Alignment is convention-enforced (via SKILL.md instructions), not system-enforced. An agent could create a subtask unrelated to the parent goal and the system wouldn't prevent it.

### Agent Self-Replication (Hiring)

- Only agents with `canCreateAgents: true` permission can submit hires (defaults to CEO only)
- Hire creates agent in `pending_approval` status — cannot run, cannot get API keys
- Board must approve before activation
- The `paperclip-create-agent` skill teaches agents to be reflective about hiring: check existing agents, compare configs, pick appropriate adapter types, draft proper reporting lines
- Budget is proposed by the hiring agent but can be modified by the board before approval

### Budget/Cost Enforcement

- `cost_events` table records per-run token usage and cost in cents
- Atomically increments `agents.spentMonthlyCents` on each cost event
- **Hard stop at 100%:** Agent immediately paused when `spent >= budget`
- **Soft guidance at 80%:** SKILL.md says "Above 80%, focus on critical tasks only" — but this is advisory, not enforced by code
- Monthly reset cycle

### The Heartbeat Protocol (SKILL.md)

The core protocol every agent follows on each wake:

1. **Identity** — `GET /api/agents/me` (id, company, role, chain of command, budget)
2. **Approval follow-up** — Handle resolved approvals if `PAPERCLIP_APPROVAL_ID` is set
3. **Get assignments** — Filter issues by status + assignee
4. **Pick work** — Priority ordering with blocked-task dedup
5. **Checkout** — Atomic task claim (mandatory before any work, 409 on conflict)
6. **Understand context** — Read issue + ancestors + comments
7. **Do the work** — Agent's actual domain capabilities
8. **Update status** — Must comment before exiting, set blocked if stuck
9. **Delegate** — Create subtasks with proper parentId and goalId

Critical rules: "Never retry a 409." "Never look for unassigned work." "Always checkout before working." "Always comment on in_progress work before exiting."

**How prescriptive:** Very. But it's convention, not enforcement. The server enforces atomic checkout (409), budget auto-pause, and approval gates. Everything else relies on faithful SKILL.md adherence.

### 24/7 Operation

- Each agent has configurable `heartbeat.intervalSec` (e.g., 3600 = hourly)
- **External scheduler required** — The server manages queuing/execution but the timer itself needs cron/systemd
- Wake triggers: timer, task assignment, @-mention, manual invoke, approval resolution
- `maxConcurrentRuns` (1-10, default 1) controls parallelism
- `withAgentStartLock()` serializes starts per agent to prevent race conditions
- Wakeup coalescing: multiple triggers for the same agent are merged into one run

### Verdict

**A more honest tagline:** "Your AI workforce runs itself. You run the board."

The system requires human intervention for initial setup, hire approvals, strategy sign-off, and budget management. Agents operate autonomously within those guardrails. This is arguably the correct design — a truly zero-human AI company would have no safety valves — but the "zero-human" branding is misleading.

---

## What Would Our Agent-Swarm Need for a Similar Model

### What we already have that maps

| Our system | Paperclip equivalent |
|---|---|
| Shift system (shift-manager.ts) | Heartbeat scheduling |
| Lead/worker agent roles | CEO/manager/IC hierarchy |
| Swarm messaging via REST API | Issue comments + @-mentions |
| PTY session persistence | agentTaskSessions + runtime state |
| Task board (task-board.ts) | Issues system |
| WebSocket live updates | Live events (WS) |
| Cron jobs on offices | Heartbeat timer |
| Office slots with roles | Agent templates with adapter types |

### What we'd need to add for low-human operation

1. **Atomic task checkout** — Optimistic locking on task claim, 409 on conflict, stale lock release on agent crash
2. **Approval gates** — Approval queue, board UI, middleware to block actions until approved, agent wakeup on resolution
3. **Goal hierarchy** — Goals → Projects → Issues → Sub-issues with ancestor context delivery
4. **Budget/cost tracking** — Per-agent cost recording, budget ceiling with auto-pause, monthly reset, dashboard
5. **Agent self-hiring** — API for lead agents to propose new agents, permission gating, approval flow
6. **Event-driven waking** — Wake workers on task assignment or @-mention (not just cron)

### The Minimal Path

Extend our shift system so that:
1. Lead agents run on cron schedule (already have this)
2. Lead agents create tasks and assign to workers (already have this)
3. Workers auto-wake when assigned a task (NEW — need event-driven wake)
4. Workers claim tasks atomically (NEW — need checkout locking)
5. Workers report status back to task board (already have this via swarm CLI)
6. Human intervenes only for: initial setup, reviewing completed work, budget control

This gives 80% of Paperclip's value without the full governance apparatus.

---

## Recommended Priority (When Ready)

1. **Atomic task checkout** — Prevents duplicate work, handles crash recovery
2. **Cost/token tracking** — Visibility into spend per agent/shift
3. **Skills via `--add-dir`** — Modular prompt system
4. **Structured transcript view** — Better monitoring at scale
5. **Approval gates** — Safety for autonomous agents
6. **Session persistence** — Better rotation/handoff
7. **WS → React Query** — Cleaner state management (larger refactor)
