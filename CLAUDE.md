# Agent Swarm

## Security — Open Source Repo

This is a public open-source repository. Before every commit:

- **Check `.gitignore`** — Ensure `.env`, `data/agents/`, `data/docker/`, and any files containing secrets are gitignored.
- **Never commit API keys, tokens, or credentials** — All secrets belong in `.env` (which is gitignored). If you see a key in source code, move it to `.env` and reference via `process.env`.
- **Never commit agent identity data** — The `data/` directory contains per-agent JSON files and Docker volume state. It must stay gitignored.
- **Audit new files** — When creating new files, consider whether they could contain sensitive data. When in doubt, add to `.gitignore`.

## Project Structure

- `server/` — Express + WebSocket + node-pty backend (TypeScript, runs via tsx)
  - `server/services/swarm-registry.ts` — In-memory swarm membership and role management
  - `server/services/swarm-prompts.ts` — System prompt templates for agent swarm awareness
  - `server/routes/swarm.ts` — REST API for agent-to-agent messaging (`/api/swarm/*`)
- `client/` — React + Vite frontend (xterm.js terminals, react-mosaic tiling)
- `docker/` — Dockerfile for sandboxed agent containers
- `data/` — Runtime data (agents JSON, Docker volumes) — gitignored

## Dev Commands

- `npm run dev` — Start server + client concurrently
- `docker build -t agent-swarm-sandbox docker/` — Build the sandbox image

## Swarm Coordination

- Agents communicate via REST API at `/api/swarm/*` — all agents use `curl` to send/receive messages
- Messages are injected into agent terminals via `session.pty.write()` with `[SWARM from <name>]:` framing
- Agents authenticate with `X-Session-Id` header (session ID passed via `AGENT_SWARM_SESSION_ID` env var)
- Single lead agent at a time — user designates at launch or toggles via crown icon in tile toolbar
- Claude Code agents get full swarm instructions via `--append-system-prompt`
- Non-Claude agents (Gemini, Codex, Bash) get env vars + a one-time terminal-injected orientation message
- Docker agents reach the host API via `http://host.docker.internal:${PORT}`

## Conventions

- Claude Code supports "Autonomous" (uses `--dangerously-skip-permissions`) and "Regular" permission modes — selectable per session
- Docker is optional — UI only shows Docker toggle when Docker is detected
- Agent identities are provisioned with AgentMail (optional, degrades gracefully)
