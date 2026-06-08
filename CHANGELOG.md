# Changelog

All notable changes to Visionary are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- CI workflow (`.github/workflows/test.yml`) — runs `npm run verify` on every push to `main` and every pull request, against Node 20.x and 22.x.
- `VERSION` file as the canonical version source.
- `CHANGELOG.md` (this file).

### Coming in v2.0.0 (in progress)
- PWA support — installable, offline-capable shell (#1)
- Mobile-responsive layout (#2)
- SQLite export / import endpoints for backup + portability (#3)
- Agent runtime adapter interface (#4)
- Settings panel — port, workspace, theme, default runtime (#5)

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

[Unreleased]: https://github.com/ZombieDuckling/visionary/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ZombieDuckling/visionary/releases/tag/v0.1.0
