# Project Research Summary

**Project:** Visionary Mission Control
**Domain:** Single-user agent orchestration dashboard with project management
**Researched:** 2026-05-13
**Confidence:** HIGH

## Executive Summary

Visionary is a single-user ops center for orchestrating 8+ AI agents via the OpenClaw platform. The expert-recommended approach is a radically minimal stack: a single Node.js 22 server using stdlib modules (no Express), better-sqlite3 as the sole npm dependency, Server-Sent Events for real-time push, and a vanilla JS SPA with no build step. This mirrors how experienced developers build internal tools -- strip away every abstraction that does not earn its keep. The competitive landscape (Mission Control, CrewAI, AutoGen Studio, LangGraph) confirms that kanban + agent dispatch + real-time telemetry is the proven pattern, but Visionary's differentiators -- interview-based task shaping and Jarvis-as-smart-dispatcher -- have no direct competitors.

The architecture is a single-process Node.js server with an embedded or co-located SPA, SQLite persistence in WAL mode, an in-process EventEmitter bus wiring REST mutations to SSE broadcast, and execFile-based agent dispatch. All four research tracks converge on the same build order: database and state management foundations first, then core board UI, then agent integration, then notifications and polish. This order is driven by hard dependency chains (everything depends on SQLite; dispatch depends on tasks existing; notifications depend on agent results).

The four most expensive risks are: (1) template literal escaping nightmares from embedding HTML in JS -- already encountered, must be resolved by serving HTML from a separate file; (2) SQLite corruption from missing WAL/busy_timeout configuration; (3) runaway agents burning tokens with no kill switch or timeout; (4) vanilla JS state management degenerating into DOM-reading spaghetti. All four must be addressed in the foundation phase before feature work begins. The research is high-confidence overall, drawing from official documentation (MDN, Node.js, SQLite, better-sqlite3) and validated against real-world agent orchestration platforms.

## Key Findings

### Recommended Stack

The entire server runs on Node.js 22 LTS using only stdlib modules: node:http for the server and SSE, node:child_process (execFile) for agent dispatch, node:crypto for UUIDs, node:fs for workspace file access. The sole npm dependency is **better-sqlite3** for synchronous SQLite access with WAL mode. The frontend is vanilla ES2022+ JavaScript served as static files (or embedded), using native browser APIs: EventSource for SSE, HTML5 Drag and Drop for kanban, CSS Custom Properties for theming.

**Core technologies:**
- **Node.js 22 + stdlib**: HTTP server, SSE streaming, CLI dispatch -- replaces Express, uuid, body-parser, ws, nodemon, execa
- **better-sqlite3**: Synchronous SQLite with prepared statements and transactions -- the only npm dependency
- **Vanilla JS SPA**: Proxy-based reactive state, hash routing, template literal components -- no React, no build step
- **SSE (EventSource)**: Native server-to-client push with auto-reconnect and Last-Event-ID replay -- no WebSocket library

### Expected Features

**Must have (table stakes):**
- Agent status cards -- at-a-glance view of which agents are alive, idle, working, or errored
- Task dispatch to agents -- command bar or click-to-dispatch mapped to openclaw agent CLI
- Task list/kanban board -- CRUD with priority, agent assignment, drag-and-drop columns
- Real-time activity feed -- SSE-pushed timestamped event stream
- Agent run history/logs -- per-agent viewer showing input, actions, output
- Notification/inbox center -- actionable items with approve/dismiss from agent outputs
- Cron schedule visibility -- timeline of 7 cron jobs with next/last run status
- Keyboard shortcuts -- Cmd+K command palette, vim-style navigation (Linear-inspired)
- Dark theme ops-center aesthetic -- monospace, high density, Bloomberg Terminal meets sci-fi
- Search -- full-text across tasks, logs, agent outputs

**Should have (differentiators):**
- Interview/shaping mode -- AI-assisted task refinement before dispatch (signature feature, no competitor equivalent)
- Orchestrator routing -- Jarvis evaluates ambiguous tasks and routes to the right sub-agent
- Unified project context panels -- per-project aggregation of docs, history, outputs, deployments
- Daily brief/audit viewers -- first-class formatted rendering of Scout, Sentinel, Broker outputs
- Cost/token tracking -- per-agent and per-task usage with budget alerts

**Defer (v2+):**
- Memory/wiki browser with semantic search -- valuable but not blocking daily use
- Agent trust/performance scoring -- needs historical data accumulation
- Sub-agent spawning from tasks -- medium complexity, depends on mature dispatch system

### Architecture Approach

Single-process Node.js server (server.js) with modular internal organization (db.js, api.js, dispatcher.js, sse.js). The server handles three roles: HTTP API (regex-based routing for ~15 routes), SSE broker (EventEmitter bus wiring mutations to client push), and static file serving for the SPA. The frontend uses a Proxy-based reactive state store with one-way data flow (fetch -> state -> render), hash-based tab routing, and event delegation for DOM interaction. Agent dispatch uses execFile (never shell-based execution) to spawn OpenClaw CLI as child processes with hard timeouts.

**Major components:**
1. **HTTP Router + REST Controllers** -- regex route table, JSON body parsing, CRUD for tasks/projects/notifications
2. **SSE Broker + Event Bus** -- in-process EventEmitter; all mutations emit events; SSE clients receive broadcasts with monotonic IDs for replay
3. **Agent Dispatcher** -- execFile wrapper with timeout, ANSI stripping, JSON parsing, PID tracking for kill switch
4. **Database Layer** -- better-sqlite3 with WAL mode, prepared statement cache, migration system, transactional dispatch operations
5. **Frontend State Store** -- Proxy-based reactive object driving selective re-renders of component functions that return HTML strings

### Critical Pitfalls

1. **Template literal escaping (CRITICAL)** -- Already encountered. Embedding HTML/CSS/JS in a template literal creates nested escaping hell and XSS risk from agent output containing backticks. Fix: serve HTML from a separate file via fs.readFileSync, not embedded in server.js.
2. **SQLite corruption from missing WAL config (CRITICAL)** -- Without WAL mode and busy_timeout, concurrent access causes SQLITE_BUSY errors and silent data loss. Fix: set WAL, busy_timeout=5000, and enforce single-writer pattern in the first lines of database init.
3. **Runaway agents burning tokens (CRITICAL)** -- Non-deterministic LLM agents can loop indefinitely. Fix: hard timeout on execFile (5 min), kill switch in UI, circuit breaker after N consecutive failures, token budget tracking.
4. **Vanilla JS state spaghetti (CRITICAL)** -- Without a central state store from day one, DOM manipulation scatters across handlers and UI becomes inconsistent. Fix: Proxy-based state object with one-way data flow established before any feature code.
5. **Race conditions in multi-agent state (HIGH)** -- Parallel agent completions can overwrite each other. Fix: optimistic locking with version column, dispatch queue, idempotent result recording, task status state machine.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation
**Rationale:** Every feature depends on the database, the server, the state management pattern, and the HTML serving approach. The four most expensive pitfalls (template escaping, SQLite config, state management, schema migration) must be resolved here.
**Delivers:** Running server, SQLite with migrations, static HTML/CSS/JS served from files, Proxy-based state store, dark theme shell with nav tabs, basic task CRUD API and UI.
**Addresses:** Persistent storage, dark theme ops-center aesthetic, task creation with metadata, keyboard shortcut foundation (Cmd+K skeleton).
**Avoids:** Pitfall 2 (template escaping) by separating HTML from server.js; Pitfall 1 (SQLite corruption) by configuring WAL from line one; Pitfall 7 (state spaghetti) by establishing central store; Pitfall 11 (migration pain) by building version-based migration system first.

### Phase 2: Core Board and Agent Cards
**Rationale:** The kanban board and agent status cards are the primary daily-driver views. Drag-and-drop and agent display depend on the state store and task CRUD from Phase 1.
**Delivers:** Kanban board with 4 columns and drag-and-drop, agent status cards showing idle/busy/error, task detail view, priority-based card styling.
**Addresses:** Task list/board view, agent status cards.
**Avoids:** Pitfall 8 (information overload) by using progressive disclosure -- idle agents collapsed, critical items elevated.

### Phase 3: Agent Dispatch and Real-Time
**Rationale:** Dispatch is the core value proposition but depends on tasks and agents existing in the UI. SSE wiring depends on the event bus pattern. This is where the CLI integration fragility and runaway agent pitfalls become real.
**Delivers:** Command bar dispatch (@agent message), task-level dispatch button, SSE real-time updates, activity feed, agent run tracking with progress indicator, kill switch for running agents.
**Addresses:** Task dispatch, real-time activity feed, agent run history/logs.
**Avoids:** Pitfall 3 (runaway agents) with hard timeout + kill switch; Pitfall 6 (CLI fragility) with execFile + ANSI strip; Pitfall 4 (race conditions) with dispatch queue + optimistic locking; Pitfall 10 (zombie processes) with PID tracking; Pitfall 5 (SSE memory leaks) with close cleanup + keepalive.

### Phase 4: Notifications, Crons, and Viewers
**Rationale:** Notifications and cron display depend on agent dispatch producing results. Brief/audit viewers depend on filesystem access patterns established in dispatch.
**Delivers:** Notification inbox with severity tiers, cron schedule timeline, daily brief viewer, security audit viewer, search across tasks and logs.
**Addresses:** Notification/inbox center, cron schedule visibility, daily brief/audit viewers, search.
**Avoids:** Pitfall 12 (notification fatigue) with severity classification + auto-dismiss routine; Pitfall 9 (stale data) with freshness indicators + optimistic UI.

### Phase 5: Intelligence (Differentiators)
**Rationale:** Interview mode and orchestrator routing are the signature features but depend on all prior infrastructure. They are high-complexity and benefit from having real usage data from Phases 1-4.
**Delivers:** Interview/shaping mode for task refinement, Jarvis-as-dispatcher for ambiguous tasks, project context panels, cost/token tracking per agent.
**Addresses:** Interview/shaping mode, orchestrator routing, unified project context panels, cost/token tracking.

### Phase Ordering Rationale

- **Dependency-driven:** SQLite -> task CRUD -> board UI -> dispatch -> notifications. Each phase builds on the previous.
- **Risk-front-loaded:** The four critical pitfalls are all addressed in Phase 1, before feature velocity matters.
- **Daily-driver-fast:** After Phase 3, the dashboard replaces the current one for daily use. Phases 4-5 add polish and differentiation.
- **Architecture-grouped:** Each phase maps to a clean architectural boundary (database layer, UI layer, dispatch layer, notification layer, intelligence layer).

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Agent Dispatch):** OpenClaw CLI --json output format needs validation against actual responses. Error codes, ANSI behavior, and gateway health check commands are inferred, not verified.
- **Phase 5 (Intelligence):** Interview/shaping mode has no direct competitor to reference. The interaction pattern (multi-turn refinement before dispatch) needs UX prototyping.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** SQLite WAL, Node.js HTTP server, vanilla JS state store -- extremely well-documented patterns.
- **Phase 2 (Core Board):** Kanban with HTML5 drag-and-drop -- multiple tutorials and reference implementations exist.
- **Phase 4 (Notifications):** Inbox/notification patterns are standard; cron display is a read-only view.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Official docs (Node.js, SQLite, better-sqlite3, MDN). Zero-dep approach validated by multiple sources. |
| Features | HIGH | 9 competitor platforms surveyed. Table stakes clearly delineated from differentiators. |
| Architecture | HIGH | Single-process Node + SQLite + SSE is a proven pattern with extensive documentation. |
| Pitfalls | HIGH | 12 pitfalls identified from official docs, production incident reports, and community analysis. Top 4 are well-documented. |

**Overall confidence:** HIGH

### Gaps to Address

- **OpenClaw CLI --json output format:** The exact JSON structure of agent responses is inferred from project context, not verified against actual CLI output. Needs validation in Phase 3 planning.
- **OpenClaw cron list command:** The openclaw cron list --json command and its output format are assumed. Needs verification before Phase 4.
- **Interview mode UX pattern:** No competitor implements pre-dispatch task shaping. The multi-turn interview flow needs design exploration in Phase 5.
- **Token/cost data availability:** Whether OpenClaw exposes token usage per agent run is unknown. Cost tracking in Phase 5 depends on this data being accessible.
- **Agent configuration discovery:** How to enumerate available agents and their capabilities from OpenClaw CLI needs verification.

## Sources

### Primary (HIGH confidence)
- [MDN: Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) -- SSE spec and usage
- [Node.js child_process Documentation](https://nodejs.org/api/child_process.html) -- execFile patterns
- [better-sqlite3 API docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) -- prepared statements, transactions, WAL
- [SQLite WAL Documentation](https://sqlite.org/wal.html) -- concurrent access patterns
- [SQLite Performance Tuning (phiresky)](https://phiresky.github.io/blog/2020/sqlite-performance-tuning/) -- PRAGMA configuration
- [MDN: HTML Drag and Drop API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/Kanban_board) -- kanban implementation

### Secondary (MEDIUM confidence)
- [Mission Control by builderz-labs](https://github.com/builderz-labs/mission-control) -- closest competitor architecture
- [AI Agent Token Budget Management](https://www.mindstudio.ai/blog/ai-agent-token-budget-management-claude-code) -- runaway agent prevention
- [UX Strategies for Real-Time Dashboards](https://www.smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/) -- information overload patterns
- [CSS-Tricks: State Management with Vanilla JavaScript](https://css-tricks.com/build-a-state-management-system-with-vanilla-javascript/) -- Proxy-based state store

### Tertiary (LOW confidence)
- OpenClaw CLI --json output format -- inferred from project context, needs validation
- OpenClaw cron list command format -- assumed, needs verification

---
*Research completed: 2026-05-13*
*Ready for roadmap: yes*
