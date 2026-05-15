# Visionary Mission Control — Handoff Prompt

Copy everything below this line into a new Claude Code session to resume work.

---

## Context

I've been building **Visionary Mission Control** — a custom project management + agent orchestration dashboard for my OpenClaw multi-agent system. It's a standalone Electron + Node.js app at `/Users/joshuasack/visionary/`.

## What Exists

### Dashboard App (`/Users/joshuasack/visionary/`)
- **server.js** — Node.js HTTP server on port 3333 with REST API, SSE, agent dispatch
- **db.js** — SQLite (better-sqlite3) with WAL mode, 5+ tables (tasks, agent_runs, notifications, activity_log, projects)
- **sse.js** — Server-Sent Events for real-time push
- **public/** — Frontend SPA (index.html, app.js, styles.css)
- **electron.js** — Electron wrapper that launches server via system Node then opens native window
- **visionary.sqlite** — Persistent database
- **macos-app/** — Swift native app attempt (deprecated, use Electron instead)

### 10 Dashboard Tabs
Board (Kanban), Agents, Activity, Inbox, Crons, Briefs, Audits, Portfolio, Memory, Projects

### Jarvis Chat Panel
Right-side chat panel that talks to Jarvis (main agent) via OpenClaw CLI. Context-aware — injects board state into every message. Collapsible with ⚙️ reopen button.

### 12 Agents (3 Runtimes)
| Agent | Runtime | Model | Role |
|-------|---------|-------|------|
| main (Jarvis) | OpenClaw | GPT-5.4 | Chief of Staff |
| scout | OpenClaw | GPT-5.4-mini | Morning Intelligence |
| analyst | OpenClaw | GPT-5.4 | Research Deep-Diver |
| forge | OpenClaw | GPT-5.4-mini | Builder |
| sentinel | OpenClaw | llama3.2:3b (local) | Security Monitor |
| broker | OpenClaw | GPT-5.4-mini | Investment Intelligence |
| ops | OpenClaw | llama3.2:3b (local) | Infrastructure |
| hunter | OpenClaw | GPT-5.4-mini | Career & Opportunities |
| reviewer | OpenClaw | GPT-5.4 | Quality Gate (auto-review) |
| coder | Claude Code | Claude Opus 4.6 | Deep coding |
| researcher | Gemini CLI | Gemini 2.5 Pro | Multi-source research |
| designer | OpenClaw | GPT-5.4-mini | UI/UX |

### Automated Flows
- Task dispatch via `POST /api/dispatch` → OpenClaw/Claude/Gemini CLI
- Auto-review: when agent completes → Reviewer auto-fires → APPROVE (done) or REJECT (redeploy)
- Concurrent review guard prevents duplicate review loops
- Inter-agent messaging via `POST /api/messages`
- `buildDispatchCommand()` routes to correct CLI per agent runtime

### 7 OpenClaw Cron Jobs
Morning brief (Scout 06:00), Daily build (Forge 02:00), Security audits 2x (Sentinel 07:00/19:00), Wiki reindex (Jarvis 05:00), LinkedIn daily + weekly

### Karpathy Memory Wiki
571 chunks, semantic search via nomic-embed-text/Ollama at `~/.openclaw/workspace/scripts/karpathy-memory.py`

### Key Files Outside This Repo
- `~/.openclaw/workspace/VISIONARY.md` — Agent guide (API reference, agent list, file locations)
- `~/.openclaw/workspace/AGENTS.md` — Boot file (reads VISIONARY.md at session start)
- `~/.openclaw/workspace/SOUL.md` — Jarvis personality
- `~/.openclaw/workspace-*/` — Individual agent workspaces

### GSD Project Structure (`.planning/`)
5 phases completed (Foundation, Board & Agents, Dispatch & Real-Time, Notifications & Viewers, Intelligence). All 29 requirements delivered. Research, plans, and summaries in `.planning/phases/`.

## How to Run
```bash
cd /Users/joshuasack/visionary

# Browser mode
~/.nvm/versions/node/v22.22.0/bin/node server.js
open http://127.0.0.1:3333

# Electron mode (native app)
~/.nvm/versions/node/v22.22.0/bin/npx electron .
```

## Known Issues / Next Steps
1. **Electron .app bundle** — Electron works via `npx electron .` but not yet packaged as a standalone .app in /Applications. Use `electron-builder` to package.
2. **Review backlog** — 13 tasks stuck in Review from earlier when agents had sandbox issues (now fixed with sandbox=off). Need to clear them.
3. **Agent models in UI** — Dashboard shows correct friendly names (GPT-5.4 etc) but OpenClaw CLI returns internal model IDs.
4. **Voice input** — HTML has voice button wired but no backend integration yet.
5. **Codex CLI** — Rate limited, dispatch available but won't work until credits refresh.
6. **FCK YOU DANNELL** landing page at `/fu-dannel/index.html` — built by all 12 agents as a demo.

## Architecture Decisions
- SQLite WAL mode (not Convex/Postgres) — zero infra, single file, works offline
- Separate HTML files (not template literals) — prevents escaping nightmares
- better-sqlite3 as sole npm dep (+ electron for native window)
- SSE over WebSockets — simpler, auto-reconnects, no library needed
- Multi-runtime dispatch — `buildDispatchCommand()` switches CLI per agent
- Async chat — `execFile` not `execFileSync` to avoid blocking server
