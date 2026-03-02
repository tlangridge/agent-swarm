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

### Pipeline & Tasks
- **Kanban-style pipeline** — Define stages (requirements → design → implementation → review → testing → deployment)
- **Task board** — Agents create, pick, and complete tasks via the `swarm` CLI
- **Priority levels** — Urgent, High, Medium, Low with visual indicators
- **Expandable task cards** — Click to see full details, context, and history

### Coordination
- **Agent-to-agent messaging** — Agents communicate via REST API, messages injected into terminals
- **`swarm` CLI** — Bash script agents use to send messages, manage tasks, read/write shared files, and check status
- **Workspace files** — Shared file system for agents to collaborate on documents
- **Cron scheduler** — Schedule recurring prompts (e.g., "every 15m" status checks) targeting specific agents or roles
- **Webhook notifications** — HTTP callbacks on shift events

### Developer Experience
- **Project folder selection** — Pick a working directory for all agents via the header UI
- **Git worktree support** — Each agent works on a separate branch without file collisions
- **Session persistence** — Agent sessions survive server restarts
- **Workflow sidebar** — Live view of scheduled tasks, workspace files, and pipeline status

## Architecture

```
Client (React + Vite + xterm.js + react-mosaic)
    ↕ WebSocket + REST API
Server (Express + node-pty + WebSocket)
    ├── services/
    │   ├── office-store     — Office/shift persistence
    │   ├── swarm-registry   — In-memory agent membership
    │   ├── swarm-prompts    — System prompt injection
    │   ├── task-board       — File-based task storage
    │   ├── cron-scheduler   — Recurring prompt scheduler
    │   ├── workspace-files  — Shared file system
    │   ├── shift-manager    — Shift lifecycle
    │   ├── pty-writer       — Safe terminal message injection
    │   └── worktree         — Git worktree management
    ├── routes/
    │   ├── swarm            — Agent messaging API
    │   ├── tasks            — Task CRUD
    │   ├── offices          — Office management
    │   ├── crons            — Cron job management
    │   └── workspace        — Shared file API
    └── cli/swarm            — Bash CLI for agents
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
| `PORT` | No | Server port (default: `3010`) |

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

# Shared files
swarm write <path> "content"          # Write a shared file
swarm read <path>                     # Read a shared file
swarm files                           # List all shared files

# Cron jobs
swarm cron create "name" "every 15m" "prompt"  # Schedule a recurring task
swarm cron list                                # List scheduled tasks

# Status
swarm status                          # List all agents and roles
swarm whoami                          # Show own identity and role
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
    PipelinePanel.tsx            # Kanban task board
    WorkflowPanel.tsx            # Cron jobs + workspace files sidebar
    ShiftStatusBar.tsx           # Active shift status
    BroadcastBar.tsx             # Send to all terminals
    TerminalTile.tsx             # Terminal wrapper with toolbar
    WorktreeActivityPanel.tsx    # Git worktree changes
  hooks/
    useAgents.ts                 # Agent CRUD
    useOffices.ts                # Office CRUD + shift management
    useTasks.ts                  # Task polling
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
    workspace.ts                 # Shared file API
    worktrees.ts                 # Git worktree API
  services/
    office-store.ts              # Office JSON persistence
    swarm-registry.ts            # In-memory agent registry
    swarm-prompts.ts             # System prompt templates
    task-board.ts                # File-based task storage
    cron-scheduler.ts            # Interval-based cron runner
    workspace-files.ts           # Shared workspace file I/O
    shift-manager.ts             # Shift lifecycle management
    pty-writer.ts                # Safe PTY message injection

cli/
  swarm                          # Bash CLI for agent coordination

examples/
  rosters/dev-team.json          # Example office template
```

## License

MIT
