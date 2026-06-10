# Changelog

All notable changes to Visionary are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.1.0] — 2026-06-10

### The working-core release: agents actually run

Dispatch any agent from the org chart and watch real CLI output stream back live, with automatic failover across harnesses. The whole surface is redesigned as a native macOS app, boards are project-scoped, and a `vision` terminal command launches everything.

### Added
- **Agent OS core** — 16-node org chart (CEO → 4 directors → 11 ICs) from `personalities/org-chart.json`, harness failover engine, independent watchdog, cron scheduler, retention cleanup, prompt guardrails, deep-research pipeline, per-harness model cookbook, Spaces → Projects hierarchy, per-agent dispatch drawer, per-agent token-bucket rate limiting, token-aware failover replay, watchdog auto-nudge (#14–#22, org-chart era).
- **Streamed dispatch through failover** — the UI dispatch path now runs `executeWithFailover` against each agent's harness chain and streams stdout/stderr over new SSE events (`agent:output`, `agent:harness`); the drawer renders output live with a failover-position indicator. Kill switch cancels without failing over.
- **Real harness healthchecks** — all 7 adapters (openclaw, claude, hermes, cursor, codex, gemini, ollama) probe the actual CLI; boot banner reports which harnesses are available.
- **Agent personalities in dispatch** — each run is prefixed with the agent's charter so agents act their role; headless `claude` runs with tool permissions granted and stdin closed.
- **Deterministic launch** — `scripts/ensure-native.js` self-heals the better-sqlite3 ABI on `npm start`/`npm run verify`; streaming/failover/cancellation integration tests added to the verify gate.
- **`vision` terminal command + installer** — `./install.sh` sets up deps and links `vision` onto PATH: open the dash, start/stop/status, Electron app, logs.
- **Python backend (frozen)** — FastAPI port phases 0–2 (read-only routes + SSE bus, dispatch + failover, comm fabric) on port 3344; development frozen, Node remains the shipping backend (#23–#26).

### Changed
- **Native macOS UI (Apple HIG)** — full redesign: SF system fonts, Apple system colors, light/dark/system themes, translucent toolbar + source-list sidebar with SVG icons, inspector-style chat panel and agent drawer, segmented controls, Spotlight-style ⌘K, new app icon. Zero external font loads.
- **Boards are project-scoped** — the global all-tasks board is gone; `#/board` opens your last-used project board and New Task always targets the current project.
- Org chart hides legacy registry rows; run summaries unwrap OpenClaw JSON envelopes into readable text.

### Fixed
- `cursor-agent` dispatch used a nonexistent `--message` flag (now `-p`).
- Headless `claude -p` stalled ~3s waiting on stdin.
- Live dispatches no longer fail on tool-permission prompts.
- PWA manifest/theme colors and stale ROADMAP/STATE/README corrected; dead macOS Swift shell removed.

## [2.0.0] — 2026-06-08

### Major release: extensibility, portability, mobile, and a full visual overhaul

Visionary v2 is a five-feature release plus a complete UI redesign. The dashboard is now installable as a PWA, usable on a phone, backup-portable, plug-in friendly for non-OpenClaw runtimes, and configurable from a settings tab — all under a new Memphis-pop brutalist look.

### Added
- **PWA support** (#1, #7) — `public/manifest.json` + `public/sw.js`. Installable from Chrome desktop and iOS Safari "Add to Home Screen". Network-first for `/api/*`, cache-first for the static shell, SSE bypassed so real-time updates keep working. Apple-touch-icon + theme-color meta wired up.
- **Mobile-responsive layout** (#2) — breakpoints at 480px and 768px. Kanban collapses to 1-column on phones and 2×2 on small tablets. Chat panel docks to a bottom sheet on phones and slides over content as an overlay on tablets. All tap targets ≥44px in the phone breakpoint.
- **SQLite export / import endpoints** (#3) — `GET /api/export` dumps all five tables as a timestamped JSON file; `POST /api/import` restores from the same shape inside a single transaction (idempotent INSERT OR REPLACE). New "Export Data" link in the header. Round-trip smoke test included.
- **Agent runtime adapter interface** (#4) — dispatch is no longer hardcoded to `openclaw`. New `src/runtimes/` registry with adapters for `openclaw`, `claude-code`, and `hermes`. Agents gain a `runtime` column via forward migration. OpenClaw behaviour is unchanged.
- **Settings panel** (#5) — new Settings tab. Configure port, workspace path, theme, and default runtime from the UI. Persisted in SQLite via `GET /api/settings` / `PUT /api/settings`. Theme changes apply immediately; port/workspace changes require a restart.
- **Hermes gateway monitoring** (#6) — overview now surfaces the Hermes agent gateway's health when an orchestrator is configured.
- **Memphis-pop brutalist redesign** (#13) — full `public/styles.css` rewrite. Deep-black base with electric pink / cyan / lime / orange / violet accents. Hard 4px-offset shadows (no blur), 3px white borders, Archivo Black UPPERCASE labels, Inter for body, IBM Plex Mono for data. Status-colored kanban column headers (butter / cyan / orange / lime), agent cards rotate shadow color by `nth-of-type`, lime-green pulse on the LIVE SSE badge.

### Infrastructure
- CI workflow (`.github/workflows/test.yml`) — `npm run verify` on every push and PR, against Node 20.x and 22.x.
- Dependabot config — weekly npm and monthly GitHub Actions updates.
- `SECURITY.md` — threat model and private vulnerability reporting workflow.
- `VERSION` file and `CHANGELOG.md` as canonical sources.

### Changed
- Electron major: `32.3.3` → kept on 32 with builder updated to `26.15.2` (`#11`, `#12`, `9a35892`).
- `actions/checkout` bumped to v6 (`#10`).
- README "Configuration" section now documents the runtime adapter system and Settings tab.

### Fixed
- Board card priority badges render as styled spans instead of literal "badge-red" text (`30257ce`).
- Slop cleanup — removed dead `priorityBadge` hoisting collision, unified `bridgePublishMessage` / `bridgePublish` onto one `bridgePost` helper, dropped three inner `require('node:http')` shadows, removed unused `aid_removed` local in `bridge.py` (`402d8b5`).

## [0.1.0] — 2026-06-08

### Initial public release

First public cut of Visionary — a local-first desktop mission control for multi-agent AI systems.

### Added
- Tiny Node.js server (`node:http`, no Express) on port 3333
- SQLite persistence via `better-sqlite3` (the only npm dependency), WAL mode
- Server-Sent Events for real-time dashboard updates
- Vanilla JS + CSS frontend (no build step)
- Electron 32 desktop shell
- Optional Python `bridge.py` for ecosystem integrations
- Five tables: `projects`, `tasks`, `agent_runs`, `notifications`, `activity_log`
- Kanban board with drag-and-drop, agent status cards, command bar (Cmd+K)
- Dispatch engine with kill switch and activity feed
- Notifications inbox + brief/audit/portfolio viewers
- `/personalities/` — six reusable agent character docs (SOUL, VISIONARY, AGENTS, IDENTITY, MISSION_CONTROL, TEAM) as a starting template
- Full `.planning/` directory documenting how the project was built (phases 1-5)
- 14-test smoke suite (`tests/smoke.mjs`)
- MIT license, README, CONTRIBUTING, issue templates

### Configuration
- `VISIONARY_WORKSPACE` (default: `$HOME/.openclaw/workspace`)
- `VISIONARY_NODE` (default: current node binary)
- `PORT` (default: `3333`)

[Unreleased]: https://github.com/ZombieDuckling/visionary/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/ZombieDuckling/visionary/releases/tag/v2.0.0
[0.1.0]: https://github.com/ZombieDuckling/visionary/releases/tag/v0.1.0
