# Agent Swarm

A web-based command center for orchestrating teams of AI coding agents. Launch Claude Code, Gemini CLI, Codex, OpenCode, or Bash sessions in a tiled terminal interface. Assign roles, define pipelines, schedule recurring tasks, and let agents coordinate through a built-in messaging API.

![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)
![React](https://img.shields.io/badge/React-19-blue)
![Express](https://img.shields.io/badge/Express-5-green)

## Features

### Terminals & Agents
- **Multi-terminal tiling** — Drag-and-drop resizable layout powered by react-mosaic
- **Multiple CLI support** — Claude Code, Gemini CLI, Codex CLI, OpenCode, or plain Bash
- **Agent identities** — Named agents with provisioned email addresses via [AgentMail](https://agentmail.to)
- **Broadcast bar** — Send input to all active terminals simultaneously
- **Docker sandboxing** — Optionally run agents in isolated containers

### Offices & Shifts
- **Office templates** — Define reusable team configurations with agent slots, roles, and pipelines
- **Shift system** — Badge in to boot all agents at once, badge out to shut them down
- **Functional roles** — Product Manager, Architect, Developer, Tester, DevOps, Code Reviewer, Designer, Tech Writer, Data Analyst, Security
- **Lead/Worker hierarchy** — Designate a lead agent who coordinates the team
- **Spawn modes** — Eager (boot all agents at once) or Demand (boot agents only when tasks are assigned)
- **Idle auto-dismiss** — Automatically shut down agents after configurable idle periods
- **Cost & token tracking** — Per-agent cost and token usage tracking with budget ceilings and auto-pause when limits are reached

### Pipeline & Tasks
- **Kanban-style pipeline** — Define stages (requirements → design → implementation → review → testing → deployment)
- **Task board** — Agents create, pick, and complete tasks via the `swarm` CLI
- **Task dependencies** — Tasks can depend on other tasks; agents are notified when blockers clear
- **Task verification** — Run commands and record exit codes as verification runs on tasks
- **Completion reports** — Auto-generated reports with git diff stats when tasks are marked done
- **Priority levels** — Urgent, High, Medium, Low with visual indicators
- **Expandable task cards** — Click to see full details, context, and history
- **Atomic task checkout** — Optimistic locking on task claims (409 on conflict) with stale lock release on agent crash

### Coordination
- **Agent-to-agent messaging** — Agents communicate via REST API, messages injected into terminals
- **`swarm` CLI** — Bash script agents use to send messages, manage tasks, read/write shared files, and check status
- **Workspace files** — Shared file system for agents to collaborate on documents
- **Cron scheduler** — Schedule recurring prompts (e.g., "every 15m" status checks) targeting specific agents or roles
- **Webhook notifications** — HTTP callbacks on shift events
- **Skills system** — Modular agent capabilities injected via `--add-dir`, with bundled skills for code review, coordination, task management, git worktree workflows, context conservation, and more

### Developer Experience
- **Project folder selection** — Pick a working directory for all agents via the header UI
- **Per-agent worktrees** — Each agent gets its own git worktree and branch, configurable per office (per-agent, shared, or disabled)
- **Agent dashboard** — Structured status view showing current action, recent files, task stats, and circuit breaker state
- **Activity parsing** — Infer what agents are doing from terminal scrollback (editing files, running tests, git operations)
- **Session persistence** — Agent sessions survive server restarts
- **Workflow sidebar** — Live view of scheduled tasks, workspace files, and pipeline status
- **Circuit breaker** — Automatic failure tracking per agent with visual indicators
- **API key management** — Global and per-office API key configuration via a dedicated UI panel
- **Context monitoring** — Track agent context window usage to avoid exceeding limits
- **Notifications** — Desktop and browser notification support for shift events and task updates

## Architecture

```
Client (React + Vite + xterm.js + react-mosaic)
    ↕ WebSocket + REST API
Server (Express + node-pty + WebSocket)
    ├── services/
    │   ├── office-store      — Office/shift persistence
    │   ├── swarm-registry    — In-memory agent membership
    │   ├── swarm-prompts     — System prompt injection
    │   ├── task-board        — File-based task storage
    │   ├── cron-scheduler    — Recurring prompt scheduler
    │   ├── workspace-files   — Shared file system
    │   ├── shift-manager     — Shift lifecycle + idle monitoring
    │   ├── activity-parser   — Terminal scrollback analysis
    │   ├── pty-writer        — Safe terminal message injection
    │   ├── worktree          — Git worktree management
    │   ├── cost-tracker      — Per-agent cost & token tracking
    │   ├── key-store         — API key management (global + per-office)
    │   ├── skill-registry    — Skill discovery and registration
    │   ├── skill-injector    — Skill injection via --add-dir
    │   ├── skill-installer   — Skill installation
    │   ├── context-monitor   — Context window usage tracking
    │   ├── notification-mgr  — Desktop/browser notifications
    │   ├── session-persist   — Session persistence across restarts
    │   └── webhooks          — Webhook notification delivery
    ├── routes/
    │   ├── swarm             — Agent messaging API
    │   ├── tasks             — Task CRUD
    │   ├── offices           — Office management
    │   ├── crons             — Cron job management
    │   ├── workspace         — Shared file API
    │   └── keys              — API key management
    └── cli/swarm             — Bash CLI for agents
```

## Getting Started

### Prerequisites

- Node.js 20+
- At least one supported CLI tool installed:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude`)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini`)
  - [Codex CLI](https://github.com/openai/codex) (`codex`)
  - [OpenCode](https://github.com/nichochar/open-code) (`opencode`)
- Docker (optional, for sandboxed execution)

### Install & Run

```bash
git clone https://github.com/tomridge/agent-swarm.git
cd agent-swarm
npm install
cp .env.example .env
npm run dev
```

Opens the dashboard at `http://localhost:5173` with the API on port 3010.

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `AGENTMAIL_API_KEY` | Recommended | [AgentMail](https://agentmail.to) API key for agent email provisioning |
| `ANTHROPIC_API_KEY` | No | API key for Claude Code agents |
| `OPENAI_API_KEY` | No | API key for Codex CLI agents |
| `SWARM_CODEX_MODEL_LEAD` | No | Codex model for lead sessions (default: `gpt-5.4`) |
| `SWARM_CODEX_MODEL_WORKER` | No | Codex model for worker sessions (default: `gpt-5.3-codex`) |
| `SWARM_CODEX_REASONING_EFFORT` | No | Codex reasoning effort for all roles (default: `xhigh`) |
| `GOOGLE_API_KEY` | No | API key for Gemini CLI agents |
| `GEMINI_API_KEY` | No | Alternative API key for Gemini CLI agents |
| `PORT` | No | Server port (default: `3010`) |

If you run multiple checkouts at once (for example `agent-swarm` and `agent-swarm-stable`), set a different `PORT` in each repo's `.env`.
The frontend proxy follows that same `PORT` automatically.

## Usage

### Quick Start

1. Open the dashboard and click **New Office**
2. Add agent slots — pick a CLI type and functional role for each
3. Define pipeline stages (or use defaults)
4. Click **Badge In** to boot all agents simultaneously
5. Agents auto-register with the swarm and start accepting tasks
6. Use the **broadcast bar** to send commands to all agents at once
7. Click **Badge Out** when the shift is done

### The `swarm` CLI

Agents interact with the swarm through a bash CLI that's automatically added to their PATH:

```bash
# Messaging
swarm send <agent-name> "message"     # Send to a specific agent
swarm broadcast "message"             # Message all agents
swarm inbox                           # Check received messages

# Tasks
swarm task list                       # List all tasks
swarm task create "title" "stage"     # Create a task
swarm task pick <id>                  # Self-assign + start a task
swarm task done <id>                  # Mark task complete
swarm task update <id> key=value      # Update task fields
swarm task verify <id> <command...>   # Run command, record exit code as verification

# Shared files
swarm write <path> "content"          # Write a shared file
swarm read <path>                     # Read a shared file
swarm files                           # List all shared files

# Cron jobs
swarm cron create "name" "every 15m" "prompt"  # Schedule a recurring task
swarm cron list                                # List scheduled tasks

# Status
swarm status                          # List all agents and roles
swarm dashboard                       # Structured status with actions, files, stats
swarm whoami                          # Show own identity and role
swarm summon <agent-name>             # Boot a pending (unbooted) shift slot
swarm worktrees                       # Show worktree overview with assignments
```

### Office Templates

Offices define a team structure as JSON. See [`examples/rosters/dev-team.json`](examples/rosters/dev-team.json) for a full example:

```json
{
  "name": "Core Dev Team",
  "slots": [
    { "name": "PM", "functionalRole": "product-manager", "cliType": "claude" },
    { "name": "Arch", "functionalRole": "architect", "cliType": "claude" },
    { "name": "Dev-1", "functionalRole": "developer", "cliType": "claude" },
    { "name": "QA", "functionalRole": "tester", "cliType": "claude" }
  ],
  "pipeline": [
    { "name": "requirements", "assignedRoles": ["product-manager"] },
    { "name": "design", "assignedRoles": ["architect"] },
    { "name": "implementation", "assignedRoles": ["developer"] },
    { "name": "testing", "assignedRoles": ["tester"] }
  ]
}
```

## Docker Sandboxing

Build the sandbox image and toggle Docker mode in the agent picker:

```bash
docker build -t agent-swarm-sandbox docker/
```

Docker agents get persistent volumes for config and workspace, credential seeding from authenticated agents, and the same swarm API access via `host.docker.internal`.

## Project Structure

```
client/src/
  App.tsx                        # Main app — WebSocket, sessions, mosaic layout
  components/
    OfficeDashboard.tsx          # Office cards, badge in/out
    OfficeEditor.tsx             # Create/edit office templates
    AgentPicker.tsx              # Launch individual agents
    AgentCard.tsx                # Agent dashboard cards
    ApiKeyManager.tsx            # API key management UI
    OfficeTabBar.tsx             # Tab bar for office navigation
    PipelinePanel.tsx            # Kanban task board
    WorkflowPanel.tsx            # Cron jobs + workspace files sidebar
    ShiftStatusBar.tsx           # Active shift status
    BroadcastBar.tsx             # Send to all terminals
    TerminalTile.tsx             # Terminal wrapper with toolbar
    WorktreeActivityPanel.tsx    # Git worktree changes
  hooks/
    useAgents.ts                 # Agent CRUD
    useHashRoute.ts              # Hash-based routing
    useNotifications.ts          # Desktop/browser notifications
    useOffices.ts                # Office CRUD + shift management
    useTasks.ts                  # Task polling
    useWorktreeOverview.ts       # Worktree overview
    useWorktrees.ts              # Worktree management

server/
  index.ts                       # Express + WebSocket setup
  pty-manager.ts                 # PTY session lifecycle (local + Docker)
  ws-handler.ts                  # WebSocket message routing
  routes/
    swarm.ts                     # Agent messaging + registration
    tasks.ts                     # Task CRUD API
    offices.ts                   # Office management API
    crons.ts                     # Cron job API
    keys.ts                      # API key management API
    workspace.ts                 # Shared file API
    worktrees.ts                 # Git worktree API
  services/
    office-store.ts              # Office JSON persistence
    swarm-registry.ts            # In-memory agent registry
    swarm-prompts.ts             # System prompt templates
    task-board.ts                # File-based task storage
    cron-scheduler.ts            # Interval-based cron runner
    workspace-files.ts           # Shared workspace file I/O
    shift-manager.ts             # Shift lifecycle + idle monitoring
    activity-parser.ts           # Terminal scrollback analysis
    pty-writer.ts                # Safe PTY message injection
    worktree.ts                  # Git worktree management
    cost-tracker.ts              # Per-agent cost & token tracking
    context-monitor.ts           # Context window usage tracking
    key-store.ts                 # API key management (global + per-office)
    skill-injector.ts            # Skill injection via --add-dir
    skill-installer.ts           # Skill installation
    skill-registry.ts            # Skill discovery and registration
    notification-manager.ts      # Desktop/browser notification delivery
    session-persistence.ts       # Session persistence across restarts
    webhooks.ts                  # Webhook notification delivery

cli/
  swarm                          # Bash CLI for agent coordination

skills/
  code-review/SKILL.md           # Code review skill
  context-conservation/SKILL.md  # Context conservation skill
  git-worktree/SKILL.md          # Git worktree workflow skill
  lead-agent/SKILL.md            # Lead agent coordination skill
  shift-protocol/SKILL.md        # Shift protocol skill
  swarm-coordination/SKILL.md    # Swarm coordination skill
  task-management/SKILL.md       # Task management skill
  worker-agent/SKILL.md          # Worker agent skill

examples/
  rosters/dev-team.json          # Example office template
```

## License

MIT
