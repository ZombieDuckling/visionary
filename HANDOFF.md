# Visionary — Handoff Prompt

Copy everything below into a fresh Claude Code session to resume.

---

## What this is

**Visionary Mission Control** — a local-first desktop dashboard that orchestrates a multi-agent AI organization. Electron + tiny Node.js server (no Express) + SQLite + vanilla-JS frontend. Public OSS at <https://github.com/ZombieDuckling/visionary>. Currently at `v2.0.0` on `main`.

The current synthwave-arcade UI is the visible surface. The substantive work is the agent OS underneath: 16-node org chart, pluggable harness adapters, failover engine, watchdog, cron scheduler, cleanup, prompt guardrails, and a deep-research workflow.

## Hard invariants — do not break

- **One npm runtime dep:** `better-sqlite3`. (Electron + electron-builder are devDeps.) Any new feature that needs another npm package is a separate decision — ask before adding.
- **No build step on the frontend.** Vanilla JS, vanilla CSS, embedded `<script>`. Google Fonts is the only external network call.
- **No framework on the backend.** `node:http` + `node:fs` + `node:child_process` + better-sqlite3. No Express, no ORM.
- **SSE, not WebSocket.** `/api/events` streams events; the SW must never cache that path.
- **Single-user, local-first.** Server binds 127.0.0.1. SQLite file `visionary.sqlite` stays on disk.

## Layout

```
visionary/
├── server.js              # All HTTP routes + dispatch + scheduler tick + cleanup tick
├── db.js                  # Schema migrations + prepared statements + org-chart bootstrap
├── sse.js                 # Event bus + client registry
├── electron.js            # Desktop shell
├── bridge.py              # Inter-agent message bridge (Python, port 3335)
├── watchdog.py            # Independent Python process, polls /api/org every 60s
├── public/
│   ├── index.html         # Shell — top bar, sidebar, main, chat, status bar
│   ├── app.js             # SPA — Proxy-based reactive state, tab router, all views
│   ├── styles.css         # Synthwave HUD theme (deep purple + neon)
│   ├── sw.js              # PWA service worker (CACHE_NAME bumps on every UI change)
│   ├── manifest.json
│   └── coffee.html        # Demo page built during the failover integration test
├── src/
│   ├── runtimes/
│   │   ├── index.js       # Registry + executeWithFailover re-export
│   │   ├── failover.js    # Walks harness_chain on exhaustion, replays last N turns
│   │   ├── openclaw.js, claude-code.js, hermes.js, cursor.js  # Adapters
│   │   └── (codex, gemini, ollama registered inline in index.js)
│   ├── cookbook.js        # Model discovery per harness
│   ├── guardrails.js      # Canary tokens, jailbreak regex scan, token budget
│   ├── deep-research.js   # Decompose → investigate → synthesize pipeline
│   ├── scheduler.js       # 5-field cron parser + tick()
│   ├── cleanup.js         # Prune agent_messages, health_log, activity, runs
│   └── mcp.js             # STUB — needs @modelcontextprotocol/sdk decision
├── personalities/
│   ├── org-chart.json     # CEO → 4 directors → 11 ICs (source of truth)
│   ├── agents/*.md        # 16 personality files (jarvis + 4 directors + 11 ICs + template)
│   └── (SOUL.md, MISSION_CONTROL.md, etc. — pre-org-chart shared docs)
└── .planning/             # Original GSD phase plans (history)
```

## Runtime state

```bash
ps aux | grep -E "node server|watchdog.py" | grep -v grep
```

- `node server.js` (currently PID 67587) on 127.0.0.1:3333
- `python3 watchdog.py` (currently PID 57406) polling `/api/org` every 60s
- Scheduler tick + cleanup tick run inside `server.js`

If you need to restart:

```bash
cd /Users/joshuasack/Projects/visionary
pkill -f 'node server.js'
pkill -f 'watchdog.py'
nohup node server.js > /tmp/visionary-v2.log 2>&1 &
nohup python3 watchdog.py > /tmp/visionary-watchdog.log 2>&1 &
```

If `better_sqlite3.node` complains about NODE_MODULE_VERSION, run `npm run rebuild:node`.

## Architecture cheat sheet

### Org chart (config-as-code)
- `personalities/org-chart.json` declares CEO (Jarvis) → 4 directors → 11 ICs with per-node `harness_chain`, `watchdog`, and `personality_path`. Reloaded on every server boot via `bootstrapOrgChart()` in `db.js`. Runtime state (`current_harness`, `health_status`, `last_activity_at`) is preserved on re-bootstrap.

### Harness adapters
- `src/runtimes/index.js` registers: `openclaw`, `claude` (alias `claude-code`), `hermes`, `cursor`, `codex`, `gemini`, `ollama`. Each implements `{ buildCommand(ctx), dispatch, kill, healthcheck }`.
- Headless `claude -p` has `--allowedTools Read,Write,Edit,Bash,Glob,Grep,WebFetch` and `--max-turns 20` by default. Override per dispatch via body fields `allowed_tools`, `max_turns`, `dangerously_skip_permissions`.

### Failover engine (`src/runtimes/failover.js`)
- `executeWithFailover({ getRuntime, stmts, db }, agent, ctx, options)` walks the agent's `harness_chain` starting from `current_harness`.
- Exhaustion signals: rate-limit, token-limit, quota, 429, "exceeded", "weekly limit", "insufficient credit", payment-required.
- `ENOENT` (CLI not installed) is **skip**, not fail.
- On success: persists user+assistant turns to `agent_messages`, updates `current_harness`, marks `health_status=ok`, writes `agent_health_log`.
- On failover: replays last N turns (default 10) as `[CONTEXT — last N turns from prior harness]` appended to the prompt.
- On all-exhausted: marks `health_status=fail`, returns `status: "all-exhausted"`.

### Watchdog (`watchdog.py`)
- Independent Python process. Polls `/api/org`, decides per-agent action: `ok` / `health-check` / `stale-activity`.
- Triggers `POST /api/agents/:id/health-check` (which uses the runtime adapter's `healthcheck()`).
- Logs stale agents that are idle beyond `expected_activity_within_seconds` (it does NOT auto-nudge yet — easy add when you want it).

### Scheduler (`src/scheduler.js`)
- 5-field cron parser. `tick({ stmts, fireSchedule })` runs every 60s inside `server.js`.
- `fireSchedule(row)` routes through `executeWithFailover` so each scheduled run gets the full harness chain.
- CRUD via `/api/schedules`.

### Cleanup (`src/cleanup.js`)
- Defaults: agent_messages 30d, health_log 14d, activity_log 90d, finished agent_runs 90d.
- Runs 10s after boot, then every 24h. Manual: `POST /api/cleanup`.

### Guardrails (`src/guardrails.js`)
- `generateCanary()`, `wrapWithCanary(prompt, canary)`, `detectCanaryLeak(out, canary)`.
- `detectJailbreak(text)` — 10 regex patterns.
- `estimateTokens(s)`, `budgetReport(messages, ceiling)`, `selectForReplay(messages, ceiling, mostRecentFirst)`.
- Not yet wired into the dispatch path automatically. Use them when you wire token-aware replay.

### Deep research (`src/deep-research.js`)
- `runResearch({ dispatch }, { question, maxQueries })` → decompose → per-sub-query independent failover → synthesize.
- Route: `POST /api/research { agent_id, question, max_queries }`.

### Cookbook (`src/cookbook.js`)
- `discover(name)` per-harness model list (static + runtime probes for ollama + openclaw).
- Route: `GET /api/cookbook`.

## DB schema (currently at version 6)

`projects`, `tasks`, `agent_runs`, `notifications`, `activity_log`, `interview_sessions`, `agents` (extended with org chart fields), `settings`, `spaces`, `agent_messages`, `agent_health_log`, `schedules`.

`schema_version.version = 6`. Migrations are append-only — never reorder existing entries.

## Frontend tab map

`#/overview` (5-second hero + BBN metrics + ranked missions + orchestrator panel)
`#/board` and `#/board/:projectId` (kanban, project-scoped)
`#/agents` (**pure org chart** — Jarvis → directors → ICs with health LEDs + per-agent dispatch buttons; the previous flat grid is gone)
`#/activity`, `#/inbox`, `#/crons`, `#/briefs`, `#/audits`, `#/portfolio`, `#/memory`, `#/projects`, `#/settings`.

Left sidebar shows the Space → Project tree (sets `state.currentSpaceId` and `state.currentProjectId`). Right side has the Jarvis chat panel.

## Visual conventions

- Theme: deep-purple synthwave (`#0F0026` bg, neon `#FF2EC4` magenta + `#00F0FF` cyan + `#F9F002` yellow + `#00FF9C` lime + `#FF8A2E` orange + `#FF2E5A` hot red).
- Fonts: Orbitron (display), VT323 (body), Share Tech Mono (data) — Google Fonts.
- CRT scanline overlay via `body::before`. Hard borders, glow via `box-shadow` + `text-shadow`, no rounded corners.
- Whenever you change `public/styles.css` or `public/index.html`, **bump `CACHE_NAME` in `public/sw.js`** so the PWA reloads.

## Working-core release (2026-06-10)

The dispatch→harness→stream critical path is now real end-to-end. See
`docs/superpowers/specs/2026-06-10-working-core-design.md`. Shipped on branch
`feat/working-core`:

- **Deterministic launch** — `scripts/ensure-native.js` (prestart/predev/presmoke)
  self-heals the better-sqlite3 ABI; `npm start`/`npm run verify` work from a clean checkout.
- **Real harness healthchecks** — all 7 adapters probe `--version`; `listRuntimes()` is async,
  `listRuntimeIds()` added. Boot banner logs which harnesses are available. Fixed `cursor-agent -p`.
- **Streaming dispatch through failover** — `dispatchAgent` now runs `executeWithFailover` against
  the agent's `harness_chain`, streaming stdout/stderr over new SSE events `agent:output` +
  `agent:harness`; the dispatch drawer renders them live. Kill switch cancels without failing over.
- **Agents actually do work** — each dispatch injects the agent's personality charter; headless
  `claude` defaults to skip-permissions and runs with stdin closed (no 3s stall).
- **Org chart** — legacy `main`/`hermes` rows hidden; clean CEO → 4 directors → 11 ICs.
- Verified live: forge/openclaw (13 streamed chunks) and coder/claude-code (clean `pong`) both complete.

## Open threads (not blocking — pick up if relevant)

- **Document ingestion** — accept PDF/docx, convert to text for agent inputs. Pattern from odysseus's `markitdown_runtime`.
- **MCP server integration** — biggest remaining lift. Stub at `src/mcp.js`. Needs `@modelcontextprotocol/sdk` (would be the second runtime dep — go/no-go decision).
- **Token/cost capture** — `agent_runs.input_tokens/output_tokens/estimated_cost_usd` columns exist but stay NULL; the dispatch path only fills them when a harness emits usage JSON (most don't).
- **Reviewer loop** — the auto-Reviewer historically rejected ~98% of work (bounded by `MAX_REVIEW_RETRIES`); the permission/personality fixes should help, but the prompt/gate logic still deserves a hard look.
- **Registry unification** — the flat `agentConfigs` (server.js) and the org-chart `agents` table are still two registries; directors aren't dispatchable via `/api/dispatch` (use `/api/agents/:id/dispatch`).
- **Python backend** — frozen at phase 2 on port 3344. Decision: ship Node. Resume the migration (phases 1c/3/4) only if consolidating to one language becomes worth it.

## Conventions when you make changes

- Match existing style. No semicolons-stripping, no arrow-fn evangelism — copy what's there.
- All SQL goes in `db.js` as prepared statements. No inline SQL in route handlers.
- Always `execFile`, never `exec` (shell-injection).
- For UI changes: bump `CACHE_NAME` in `sw.js`.
- For DB changes: add a new migration at the end of the `migrations` array. Never edit a shipped migration.
- For runtime adapters: implement `{ buildCommand, dispatch?, kill?, healthcheck? }` and register in `src/runtimes/index.js`. Default `dispatch`/`kill`/`healthcheck` are fine for simple CLIs.
- Test path: `npm run verify` (Node 22 syntax check + smoke tests). Should be 17/17.

## Recent commit history (most → least recent)

```
3de6c37 feat(odysseus-port-2): cron scheduler + cleanup service
cbfa565 feat(odysseus-port): cookbook + guardrails + deep research + MCP stub
d7718a5 feat(claude-code): allow Write/Edit/Bash tools by default for headless dispatch
785dd43 feat(agents): make the Agents tab the org chart, drop the secondary grid
d34aab9 feat(org): agent org chart + harness failover + watchdog
6dacd0f feat(spaces): add Spaces > Projects hierarchy with a left sidebar tree
9ba7cbb feat(ui): replace Win95 with Synthwave arcade HUD
1be80fb chore(release): v2.0.0
```

## Quick sanity check on resume

```bash
curl -s http://127.0.0.1:3333/api/org | jq '.ceo.reports[].name'
curl -s http://127.0.0.1:3333/api/cookbook | jq 'keys'
curl -s http://127.0.0.1:3333/api/schedules | jq '.schedules[].name'
tail -5 /tmp/visionary-watchdog.log
git log --oneline -5
```

If those all answer cleanly, the environment is healthy — pick up wherever feels right.
