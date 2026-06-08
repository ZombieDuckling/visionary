# Visionary

A local-first desktop mission control for multi-agent AI systems. One pane of glass for everything your agents are doing — dispatch work, watch progress, manage projects — without juggling Telegram, WhatsApp, terminals, and a dozen chat tabs.

Built as an Electron app on top of a tiny Node.js server (`node:http`, no Express) and a single SQLite file (`better-sqlite3`). Vanilla JS frontend, server-sent events for real-time updates, zero build step.

## Why

Most agent dashboards are SaaS, cloud-bound, and assume a team. Visionary is the opposite: one operator, one machine, one SQLite file. Your agent activity stays on your laptop. Plug in OpenClaw, Claude Code, Hermes, Codex, or whatever multi-agent stack you're running — Visionary is the surface, not the orchestrator.

## Stack

- **Runtime:** Node.js 22 LTS, native `node:http`, no Express
- **Database:** SQLite via `better-sqlite3` (single file, WAL mode)
- **Real-time:** Server-Sent Events (no WebSocket library)
- **Frontend:** Vanilla JS + CSS, no build step
- **Desktop shell:** Electron 32
- **Bridge:** Optional Python `bridge.py` for ecosystem integrations
- **Dependencies:** `better-sqlite3` is the only runtime npm dep. That's it.

## Quick start

```bash
git clone https://github.com/ZombieDuckling/visionary.git
cd visionary
npm install
npm start              # server only, visit http://127.0.0.1:3333
npm run app            # full Electron desktop app
```

Visionary is also installable as a Progressive Web App. On Chrome desktop, look for the install icon in the address bar after opening the dashboard. On iOS Safari, tap Share → "Add to Home Screen". Once installed, the app launches in standalone mode (no browser chrome) and caches the static shell for offline use — API calls remain network-first.

For the agent bridge:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt  # if present
npm run bridge
```

## Configuration

All paths are overridable via env vars — no hardcoded user directories:

| Env var | Default | What it sets |
|---|---|---|
| `VISIONARY_WORKSPACE` | `$HOME/.openclaw/workspace` | Where agent briefs / memory / portfolio live |
| `VISIONARY_NODE` | `process.execPath` (current node) | Node binary used by the Electron shell to spawn the server |
| `PORT` | `3333` | HTTP port |

## Project layout

```
visionary/
├── server.js          # HTTP + SSE + API routes
├── db.js              # SQLite schema + prepared statements
├── sse.js             # Event bus + client registry
├── electron.js        # Desktop shell
├── bridge.py          # Optional Python integration bridge
├── public/            # Vanilla JS SPA (no build)
├── personalities/     # Agent character / mission docs (see below)
├── tests/             # node:test smoke tests
└── .planning/         # Phase plans, requirements, research (transparency)
```

## Personalities

`personalities/` ships with the agent character files this project was built around. They're the "soul" of the orchestrator — voice, lanes of work, escalation rules, team structure. Treat them as a starting template:

- `SOUL.md` — Default operating principles for any agent in the system
- `VISIONARY.md` — How an agent should think about the dashboard itself
- `MISSION_CONTROL.md` — Lanes of work, daily rhythm, success criteria
- `AGENTS.md` — Boot-time context every agent loads
- `IDENTITY.md` — Identity scaffolding
- `TEAM.md` — Sub-agent roles, specialization, escalation

Fork them, rewrite them, or strip them out. Nothing in the server imports them; they're consumed by whatever agent runtime you point at the workspace.

## Roadmap and phases

Build history, requirements, and phase-by-phase plans are kept under `.planning/`. Read `PROJECT.md`, `ROADMAP.md`, and `STATE.md` to see where this is going.

## Contributing

PRs welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first — it covers the small-deps stance, the vanilla-JS rule, and the SQLite-only architecture (these are deliberate constraints, not negotiables).

## License

MIT. See [LICENSE](LICENSE).
