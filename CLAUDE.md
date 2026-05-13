<!-- GSD:project-start source:PROJECT.md -->
## Project

**Visionary Mission Control**

A custom web-based project management and agent orchestration platform for Josh's OpenClaw multi-agent system. Upgrades the current static Node.js dashboard into a full interactive operations center — inspired by Benoît's "Visionary" platform but adapted for Josh's 8-agent cybersecurity/builder/investment setup.

**Core Value:** **One place to see everything your agents are doing, dispatch work, and manage projects — without juggling Telegram/WhatsApp/terminal.**
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Runtime & Server
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Node.js | 22 LTS | Runtime, HTTP server, SSE, file I/O | Native `http` module replaces Express. Node 22 adds `crypto.randomUUID()`, `fs.glob()`, stable `node:test`, global `structuredClone()`, `URLSearchParams`. Zero-dep server is viable and maintainable. |
| `node:http` | stdlib | HTTP server, API routes, SSE streaming | `http.createServer` with manual routing via URL pathname matching. No Express needed for around 15 routes. |
| `node:child_process` | stdlib | OpenClaw CLI dispatch | `execFile('openclaw', [...args])` for agent dispatch. Use `spawn` for long-running tasks where you need streaming stdout for real-time progress. Always use `execFile` over `exec` to avoid shell injection. |
| `node:crypto` | stdlib | UUID generation | `crypto.randomUUID()` replaces the `uuid` npm package for task/agent IDs. |
| `node:fs` | stdlib | Workspace file reading | Read briefs, audits, memory chunks from `~/.openclaw/workspace`. Use `fs.readFileSync` for small files, `fs.createReadStream` for large ones. |
| `node:path` | stdlib | Path resolution | Safe cross-platform path joining for workspace files. |
| `node:url` | stdlib | URL parsing, query params | `new URL(req.url, base)` for route matching and query parameter extraction. |
### Database
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| better-sqlite3 | latest | SQLite binding | **The only npm dependency.** Synchronous API eliminates callback hell. 10x faster than node-sqlite3 for single-connection workloads. Native C++ addon, battle-tested. Prepared statements compile once, execute many times. `.transaction()` wrapper handles BEGIN/COMMIT/ROLLBACK automatically. |
| SQLite | 3.45+ (bundled) | Persistent storage | Single-file database. WAL mode enables concurrent readers without blocking writes. Perfect for single-user dashboard with one writer (server) and one reader (SSE polling). |
### Frontend (Embedded SPA)
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Vanilla JS | ES2022+ | All client-side logic | No React, no Vue, no build step. Template literal HTML embedded in `server.js`. Modern browsers support everything needed: `fetch`, `EventSource`, Drag and Drop API, CSS Grid, Custom Properties, `structuredClone`. |
| HTML5 Drag and Drop API | native | Kanban board | `draggable="true"`, `dragstart`/`dragover`/`drop` events. No library needed for column-to-column task movement. |
| EventSource (SSE) | native | Real-time updates | Built-in browser API. Auto-reconnects with exponential backoff. Sends `Last-Event-ID` header on reconnect so server can replay missed events. |
| CSS Custom Properties | native | Theming, ops-center aesthetic | Define color palette as variables: `--bg-primary`, `--accent-green`, `--text-mono`. Monospace stack: `'JetBrains Mono', 'Fira Code', 'SF Mono', monospace`. |
### Real-Time Updates (SSE Architecture)
| Component | Implementation | Why |
|-----------|---------------|-----|
| Server endpoint | `GET /api/events` with `Content-Type: text/event-stream` | Native HTTP response streaming. No WebSocket library needed. SSE is HTTP-native, works through proxies, and auto-reconnects. |
| Event format | `id: {monotonic_id}\nevent: {type}\ndata: {json}\n\n` | Standard SSE format. Monotonic IDs enable replay on reconnect. Event types: `task_update`, `agent_status`, `notification`, `activity`. |
| Client | `new EventSource('/api/events')` | Zero-dependency. Browser handles reconnection, `Last-Event-ID` header. 3-second default retry, configurable via `retry:` field from server. |
| Event store | `events` table in SQLite | Append-only. Server queries `WHERE id > ?` using `Last-Event-ID` to replay missed events on reconnect. Prune events older than 24h via cron. |
| Keep-alive | `: keepalive\n\n` every 30s | SSE comment line prevents connection timeout. No data payload, just keeps the TCP connection alive. |
## SQLite Schema Strategy
### PRAGMA Configuration (run on every connection open)
### better-sqlite3 Patterns
### Core Tables
## Server Architecture Patterns
### Native HTTP Routing (No Express)
### SSE Server Implementation
### OpenClaw CLI Dispatch Pattern
### Embedded SPA Pattern
## Node.js stdlib Capabilities (No npm Needed)
| Need | stdlib Solution | Replaces |
|------|----------------|----------|
| UUID generation | `crypto.randomUUID()` | `uuid` package |
| HTTP server | `node:http` | `express` |
| URL parsing | `new URL()`, `URLSearchParams` | `url`, `qs` packages |
| JSON body parsing | `req.on('data')` + `JSON.parse()` | `body-parser` |
| Deep clone | `structuredClone()` | `lodash.cloneDeep` |
| File watching (dev) | `node --watch server.js` | `nodemon` |
| CLI execution | `child_process.execFile/spawn` | `execa` |
| Environment vars | `process.env` | `dotenv` (if .env not needed) |
| Path manipulation | `node:path` | -- |
| Timers | `setTimeout/setInterval` | -- |
| Event handling | `node:events` EventEmitter | -- |
| Testing | `node:test` + `node:assert` | `jest`, `mocha` |
## Alternatives Considered
| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| HTTP server | `node:http` | Express | Adds 30+ transitive deps. For around 15 API routes, native is simpler and this project mandates zero deps. |
| Database | better-sqlite3 | Convex / Turso | Convex requires account + cloud. Turso adds network dependency. SQLite = single file, works offline, zero infrastructure. |
| Real-time | SSE via native HTTP | WebSocket (`ws`) | `ws` is an npm dep. SSE is HTTP-native, auto-reconnects, works through proxies, simpler server code. One-way server-to-client is sufficient for this dashboard. |
| Frontend | Vanilla JS | React/Vue/Svelte | Build step, npm deps, bundle size. Embedded template literal SPA has zero build tooling. For a single-user ops dashboard, vanilla is fast enough. |
| Templating | Template literals | EJS/Handlebars | Additional dep. JS template literals do the same thing natively. |
| Drag and Drop | HTML5 DnD API | SortableJS | Another dep. Native DnD API handles kanban column moves. Touch support can be added with pointer events if needed later. |
| Routing | if/else chain | URLPattern API | URLPattern is still experimental in Node 22. Simple pathname matching is sufficient for around 15 routes. |
## Installation
# The entire dependency tree
# That is it. One dependency.
## Development Tooling (optional, zero-dep)
# File watching for dev (Node 22 native)
# Testing (Node 22 native)
# No build step, no bundler, no transpiler
## Performance Considerations
| Concern | Approach |
|---------|----------|
| SQLite write contention | WAL mode + `busy_timeout = 5000`. Single writer is fine for single-user app. |
| SSE memory per client | Each client holds one `res` object in `sseClients` Set. Josh is the only user, so 1-3 connections max. |
| Large SPA HTML | Template literal is served from memory (no disk read). Gzip not needed for single user on localhost. |
| OpenClaw CLI latency | `execFile` is non-blocking (spawns child process). Use `spawn` for streaming long tasks. |
| Event table growth | Prune events older than 24h daily. `DELETE FROM events WHERE created_at < ?` in a scheduled interval. |
## Sources
- [MDN: Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) -- HIGH confidence, authoritative spec documentation
- [MDN: Using Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) -- HIGH confidence
- [better-sqlite3 API docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) -- HIGH confidence, official repository
- [better-sqlite3 WAL Mode and Performance Tuning](https://deepwiki.com/WiseLibs/better-sqlite3/3.4-wal-mode-and-performance-tuning) -- HIGH confidence
- [SQLite Performance Tuning (phiresky)](https://phiresky.github.io/blog/2020/sqlite-performance-tuning/) -- HIGH confidence, widely cited reference
- [Understanding SQLite PRAGMA with better-sqlite3](https://dev.to/lovestaco/understanding-sqlite-pragma-and-how-better-sqlite3-makes-it-nicer-1ap0) -- MEDIUM confidence
- [Simon Willison: JSON Audit Log in SQLite](https://til.simonwillison.net/sqlite/json-audit-log) -- HIGH confidence
- [Node.js Features Replacing npm Packages](https://nodesource.com/blog/nodejs-features-replacing-npm-packages) -- MEDIUM confidence
- [HTML Living Standard: SSE Spec](https://html.spec.whatwg.org/multipage/server-sent-events.html) -- HIGH confidence, authoritative
- [Vanilla JS Kanban with Drag and Drop](https://dev.to/keval_sindhu_6d63886782e1/i-built-a-full-kanban-board-in-vanilla-javascript-with-drag-drop-time-tracking-55a7) -- MEDIUM confidence
- [Node.js Child Process Documentation](https://nodejs.org/api/child_process.html) -- HIGH confidence, official docs
- [SQLite as Best DB for AI Agents](https://dev.to/nathanhamlett/sqlite-is-the-best-database-for-ai-agents-and-youre-overcomplicating-it-1a5g) -- MEDIUM confidence
- [Hermes Agent Kanban Schema](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban) -- MEDIUM confidence, real-world reference
- [SSE Tutorial (javascript.info)](https://javascript.info/server-sent-events) -- MEDIUM confidence
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
