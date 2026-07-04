# Visionary Mission Control

[![CI](https://github.com/ZombieDuckling/visionary/actions/workflows/test.yml/badge.svg)](https://github.com/ZombieDuckling/visionary/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node 22 LTS](https://img.shields.io/badge/Node-22%20LTS-green.svg)](https://nodejs.org)

One operator. A full org of AI agents. One dashboard.

Visionary is a local-first mission control that orchestrates a 16-node AI organization — CEO Argus down through four directors to eleven ICs — dispatching kanban tasks across OpenClaw, Claude Code, Hermes, Codex, Cursor, Gemini, and Ollama. If a harness hits a rate limit or quota wall, the failover engine quietly replays the context on the next harness in the chain. You watch live-streamed output in the dispatch drawer, and when the task finishes, every file it produced is waiting in `~/Visionary/<project>/task-<id>` — openable directly from the dashboard.

## Why

Most agent dashboards are SaaS, cloud-bound, and assume a team. Visionary assumes one operator on one machine.

- **Local-first** — the server binds `127.0.0.1`. Nothing leaves your laptop.
- **One SQLite file** — all state lives in `visionary.sqlite`. Copy it, back it up, or inspect it with any SQLite browser.
- **One npm dependency** — `better-sqlite3`. No framework, no ORM, no build step. Electron and electron-builder are devDeps; they never touch production.

## Features

### Org chart and harness failover

`personalities/org-chart.json` declares the full organization as config: CEO (Argus) → four directors → eleven ICs, each node carrying a `harness_chain`, watchdog flags, and a path to its personality charter. On every server boot the schema is reconciled without losing runtime state.

When you dispatch a task the failover engine (`src/runtimes/failover.js`) walks the agent's `harness_chain` in order. Exhaustion signals — rate limits, quota errors, 429s, weekly limits, insufficient credit — are distinguished from hard failures. If a CLI is not installed (`ENOENT`) the engine skips that harness silently. On failover, the last N turns are replayed as context so the incoming harness picks up mid-conversation. When all harnesses are exhausted the task stays in Review for the operator.

Seven adapters are registered: `openclaw`, `claude` / `claude-code`, `hermes`, `cursor`, `codex`, `gemini`, `ollama`. Each implements `{ buildCommand, dispatch, kill, healthcheck }`.

### Task artifacts

Every dispatch runs inside its own working directory: `~/Visionary/<project>/task-<id>`. The run record stores the workdir path and a JSON file list of every file produced. The task detail panel shows a Runs & Artifacts section with live output, the file list, an Open Folder button, and click-to-open for individual files. Symlink escapes and executable bundles are rejected at the API layer.

### Auto-review with evidence

After a run completes, the reviewer agent runs through its own harness chain with the artifact list as evidence and read-only tools. Reviews parse a structured `APPROVE:` / `REJECT:` first line — no keyword-anywhere false verdicts. Inconclusive results stay in Review for the operator. Rejections redispatch through the normal path (new workdir, full failover). Tasks that hit the retry ceiling stay in Review rather than bouncing back to todo.

### Cron scheduler

`src/scheduler.js` parses standard five-field cron expressions. The tick runs every 60 seconds inside `server.js` and routes each firing through `executeWithFailover`, so scheduled runs get the same harness chain and failover behavior as manual dispatches. Manage schedules from the Crons tab or via `GET|POST|DELETE /api/schedules`.

### Cost capture

The Claude adapter dispatches with `--output-format json` and extracts real `input_tokens`, `output_tokens`, and `total_cost_usd` from the harness response. Those fields are stored on `agent_runs` and surfaced in the task history panel.

### Watchdog

`watchdog.py` is an independent Python process that polls `/api/org` every 60 seconds. It decides per-agent whether to trigger a health-check (`POST /api/agents/:id/health-check`) or log a stale-activity warning. Each adapter's `healthcheck()` probes the actual CLI binary. The boot banner reports which harnesses are available.

### Prompt guardrails

`src/guardrails.js` provides canary token injection and detection, jailbreak regex scanning (ten patterns), token estimation, budget reporting, and context selection for failover replay. Guardrails are available to any dispatch path.

### Deep research

`POST /api/research { agent_id, question, max_queries }` runs a decompose → per-sub-query investigate → synthesize pipeline through `src/deep-research.js`. Each investigation leg goes through `executeWithFailover` independently.

### Streamed output

Dispatch output arrives over SSE (`agent:output`, `agent:harness` event types) and renders live in the dispatch drawer with a failover-position indicator. A kill switch cancels the run without triggering failover.

### PWA

Visionary is installable as a Progressive Web App. On Chrome desktop, look for the install icon in the address bar. On iOS Safari, tap Share and choose "Add to Home Screen". The static shell is cached for offline use; API calls remain network-first; `/api/events` is never cached.

## Quick start

```bash
git clone https://github.com/ZombieDuckling/visionary.git
cd visionary
./install.sh        # installs deps, compiles the native binding, links `vision` onto PATH
vision              # opens http://127.0.0.1:3333 in your browser
```

The `vision` command works from any directory once installed:

```bash
vision              # open the dashboard in your browser
vision start        # start the background server (and watchdog) via launchd or plain nohup
vision stop         # stop the background server
vision restart      # restart server and watchdog
vision status       # is it running?
vision logs         # tail ~/.visionary/server.log
vision app          # launch the Electron desktop shell (legacy)
```

Plain npm still works if you prefer:

```bash
npm install && npm start   # server on http://127.0.0.1:3333
```

`npm start` is self-healing: the `prestart` preflight (`scripts/ensure-native.js`) checks that the `better-sqlite3` native binding loads under the current Node ABI and rebuilds it once automatically if it does not match.

For the optional agent bridge:

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
npm run bridge
```

## Configuration

All paths are overridable via environment variables — no hardcoded user directories.

| Env var | Default | What it sets |
|---|---|---|
| `PORT` | `3333` | HTTP port |
| `VISIONARY_WORKSPACE` | `$HOME/.openclaw/workspace` | Where agent briefs, memory, and portfolio live |
| `VISIONARY_NODE` | `process.execPath` | Node binary the Electron shell uses to spawn the server |
| `VISIONARY_ARTIFACTS` | `$HOME/Visionary` | Root directory for per-task working directories |

The Settings tab lets you configure port, workspace path, theme, and default runtime from the UI. Changes persist in SQLite via `GET /api/settings` and `PUT /api/settings`. Theme changes apply immediately; port and workspace changes require a restart.

## Architecture

The server is `server.js` — all HTTP routes, the scheduler tick, and the cleanup tick run in one Node process. `db.js` holds the entire schema and every prepared statement; no SQL appears in route handlers. `sse.js` is the event bus and client registry. The org chart is config-as-code in `personalities/org-chart.json` and is reconciled into the `agents` table on every boot.

```
visionary/
├── server.js              # HTTP + SSE + API routes + scheduler tick + cleanup tick
├── db.js                  # Schema migrations (version 6) + prepared statements + org-chart bootstrap
├── sse.js                 # Event bus + client registry
├── electron.js            # Electron desktop shell
├── bridge.py              # Inter-agent message bridge (port 3335)
├── watchdog.py            # Independent Python watchdog process
├── public/                # Vanilla JS SPA — index.html, app.js, styles.css, sw.js
├── src/
│   ├── runtimes/          # Harness adapters + failover engine
│   ├── guardrails.js      # Canary tokens, jailbreak detection, token budget
│   ├── deep-research.js   # Decompose → investigate → synthesize
│   ├── scheduler.js       # 5-field cron parser
│   ├── cleanup.js         # Retention pruning (runs daily)
│   └── cookbook.js        # Per-harness model discovery
├── personalities/
│   ├── org-chart.json     # Source-of-truth org chart (CEO → directors → ICs)
│   └── agents/            # 16 personality charter files
└── tests/                 # node:test smoke tests
```

For deeper detail — schema version history, SSE event types, failover signal taxonomy, frontend tab map — read [HANDOFF.md](HANDOFF.md).

## Roadmap

Near-term:

- Token and cost capture for all harnesses (currently real only for Claude)
- MCP server integration (`src/mcp.js` stub; needs `@modelcontextprotocol/sdk` go/no-go)
- Document ingestion — accept PDF/DOCX, convert to text for agent inputs
- Registry unification — collapse the flat `agentConfigs` and the `agents` table into one source of truth; make directors dispatchable via `/api/dispatch`
- Watchdog auto-nudge — currently logs stale agents but does not redispatch them

See `.planning/ROADMAP.md` for the longer arc.

## Contributing

PRs welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. The small-deps stance, vanilla-JS rule, and SQLite-only architecture are deliberate constraints, not negotiables. The test gate is `npm run verify` (syntax check + smoke suite, currently 17/17).

## License

MIT. See [LICENSE](LICENSE).
