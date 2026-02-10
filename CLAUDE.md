# Agent Swarm

## Security — Open Source Repo

This is a public open-source repository. Before every commit:

- **Check `.gitignore`** — Ensure `.env`, `data/agents/`, `data/docker/`, and any files containing secrets are gitignored.
- **Never commit API keys, tokens, or credentials** — All secrets belong in `.env` (which is gitignored). If you see a key in source code, move it to `.env` and reference via `process.env`.
- **Never commit agent identity data** — The `data/` directory contains per-agent JSON files and Docker volume state. It must stay gitignored.
- **Audit new files** — When creating new files, consider whether they could contain sensitive data. When in doubt, add to `.gitignore`.

## Project Structure

- `server/` — Express + WebSocket + node-pty backend (TypeScript, runs via tsx)
- `client/` — React + Vite frontend (xterm.js terminals, react-mosaic tiling)
- `docker/` — Dockerfile for sandboxed agent containers
- `data/` — Runtime data (agents JSON, Docker volumes) — gitignored

## Dev Commands

- `npm run dev` — Start server + client concurrently
- `docker build -t agent-swarm-sandbox docker/` — Build the sandbox image

## Conventions

- Claude Code supports "Autonomous" (uses `--dangerously-skip-permissions`) and "Regular" permission modes — selectable per session
- Docker is optional — UI only shows Docker toggle when Docker is detected
- Agent identities are provisioned with AgentMail (optional, degrades gracefully)
