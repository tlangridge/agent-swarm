# Agent Swarm

A web-based dashboard for managing and orchestrating multiple AI agent terminals simultaneously. Launch Claude Code, Gemini CLI, Codex, or Bash sessions in a tiled interface, assign persistent agent identities with unique email addresses, and broadcast commands to all terminals at once.

![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)
![React](https://img.shields.io/badge/React-19-blue)
![Express](https://img.shields.io/badge/Express-5-green)

## Features

- **Multi-terminal tiling** — Drag-and-drop resizable layout powered by react-mosaic
- **Multiple CLI support** — Claude Code, Gemini CLI, Codex CLI, or plain Bash
- **Agent identities** — Named agents with provisioned email addresses via AgentMail
- **Broadcast commands** — Send input to all active terminals simultaneously
- **Real-time terminals** — Full PTY support with xterm.js and WebSocket streaming
- **Persistent agents** — Agent data stored as JSON, survives restarts

## Architecture

```
Client (React + Vite + xterm.js)
    ↕ WebSocket (/ws) + REST (/api)
Server (Express + node-pty + WebSocket)
    → data/agents/*.json
    → AgentMail API (optional)
```

## Getting Started

### Prerequisites

- Node.js 20+
- At least one supported CLI tool installed and on your PATH:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude`)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini`)
  - [Codex CLI](https://github.com/openai/codex) (`codex`)

### Install

```bash
npm install
```

### Configure

Copy the example env file and fill in your keys:

```bash
cp .env.example .env
```

You'll want an [AgentMail](https://agentmail.to) API key to get the most out of Agent Swarm. It gives each agent a unique email address, enabling them to send and receive email autonomously. Without it, agents still work but have no email identity.

| Variable | Required | Description |
|---|---|---|
| `AGENTMAIL_API_KEY` | Recommended | API key from [AgentMail](https://agentmail.to) for agent email provisioning |
| `PORT` | No | Server port (default: `3000`) |

### Run

**Development** (hot reload for both client and server):

```bash
npm run dev
```

Opens the client at `http://localhost:5173` with API/WebSocket proxied to port 3000.

**Production**:

```bash
npm run build
npm start
```

Serves the built client and API on `http://localhost:3000`.

## Usage

1. Click **+ Add Agent** in the header
2. Pick an existing agent or create a new one with a name and preferred CLI
3. A new terminal tile opens running your chosen CLI
4. Drag tile borders to resize, or close tiles with the X button
5. Use the **broadcast bar** at the bottom to send a command to every active terminal

When an agent identity is assigned, the CLI session receives the agent's name and email as environment variables (`AGENT_SWARM_AGENT_NAME`, `AGENT_SWARM_AGENT_EMAIL`). Claude Code sessions also get a system prompt injection identifying the agent.

## Use Cases

### Parallel code research

Spin up three Claude Code workers pointed at the same repo. Tell one to map out the database schema, another to trace the authentication flow, and a third to inventory the API endpoints. Read all three results side by side without waiting for them sequentially.

### Multi-agent task delegation

Launch a lead agent and a couple of workers. Give the lead a high-level goal like "refactor the payment module to use Stripe's new API." The lead breaks the task down, messages workers with specific sub-tasks, and synthesizes the results — all coordinated through the swarm API.

### Cross-model comparison

Open a Claude Code tile and a Gemini CLI tile side by side. Paste the same prompt into both using the broadcast bar and compare how each model approaches the problem. Useful for evaluating model strengths on your actual codebase.

### Sandboxed experimentation

Run agents in Docker containers so they can't accidentally trash your local filesystem. Useful when you want to let an agent run autonomously but don't fully trust the commands it might execute.

### Mixed-tool workflows

Use a Claude Code agent for the main coding task while a Bash agent runs your test suite in a loop, watches logs, or monitors a dev server. Everything is visible in the same tiled interface.

### Code review swarm

Point multiple workers at different parts of a large PR or codebase. Each agent reviews a subset of files and reports findings back to the lead, who compiles a unified review summary.

## Project Structure

```
client/
  src/
    App.tsx              # Main app — WebSocket, session state, mosaic layout
    components/
      AgentPicker.tsx    # Modal for selecting/creating agents
      BroadcastBar.tsx   # Send commands to all terminals
      Header.tsx         # Title bar, connection status, session count
      TerminalWindow.tsx # xterm.js terminal wrapper
    hooks/
      useAgents.ts       # Agent CRUD hook
server/
  index.ts               # Express + WebSocket server setup
  pty-manager.ts         # PTY session lifecycle
  ws-handler.ts          # WebSocket message routing
  routes/
    agents.ts            # REST API for agent CRUD
  services/
    agent-store.ts       # JSON file persistence
    agentmail.ts         # AgentMail email provisioning
data/
  agents/                # Agent JSON files
```

## License

MIT
