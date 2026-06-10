# Roadmap: Visionary Mission Control

## Overview

Visionary transforms the user's static Node.js dashboard into a full interactive operations center for orchestrating 8 OpenClaw agents. The build follows a strict dependency chain: database and server foundations first, then the kanban board and agent cards that form the daily-driver view, then agent dispatch and real-time telemetry that make it operational, then notification inbox and content viewers that surface agent outputs, and finally the intelligence features (interview mode, Jarvis routing) that differentiate Visionary from every other agent dashboard.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - SQLite database, separate HTML serving, reactive state store, design system, REST API, SSE endpoint (completed 2026-05-13)
- [x] **Phase 2: Board & Agents** - Kanban board with drag-and-drop, task CRUD, agent status cards, keyboard shortcuts (completed 2026-05-13)
- [x] **Phase 3: Dispatch & Real-Time** - Agent dispatch via CLI, command bar, kill switch, activity feed, run tracking (completed 2026-05-13)
- [x] **Phase 4: Notifications & Viewers** - Inbox with actions, cron timeline, brief/audit/portfolio viewers, memory browser (completed 2026-05-13)
- [x] **Phase 5: Intelligence** - Interview mode, Jarvis orchestrator routing, project panels, cost tracking (completed 2026-05-13)

## Phase Details

### Phase 1: Foundation
**Goal**: A running server with SQLite persistence, dark ops-center shell, and the architectural patterns that every subsequent phase builds on
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05, FOUND-06
**Success Criteria** (what must be TRUE):
  1. Server starts on port 3333 and serves a dark-themed HTML dashboard from a separate file (not a template literal)
  2. SQLite database exists with WAL mode enabled and all 5 tables (projects, tasks, agent_runs, notifications, activity_log) created via migration
  3. User can create, read, update, and delete tasks via the REST API and see changes reflected in the browser
  4. Browser receives real-time push updates via SSE when data changes on the server
  5. Frontend state updates flow through a central reactive store (no direct DOM reads for state)
**Plans**: 3 plans (Wave 1: 01, Wave 2: 02+03 parallel)

Plans:
- [x] 01-01-PLAN.md — Database + server foundation (package.json, db.js, server.js, public/index.html)
- [x] 01-02-PLAN.md — REST API CRUD + SSE real-time push (server.js routes, sse.js)
- [x] 01-03-PLAN.md — Frontend state store + design system (public/app.js, public/styles.css, public/index.html)

### Phase 2: Board & Agents
**Goal**: Users can manage tasks on a visual kanban board and see at-a-glance status of all 8 agents
**Depends on**: Phase 1
**Requirements**: BOARD-01, BOARD-02, BOARD-03, BOARD-04, BOARD-05, BOARD-06
**Success Criteria** (what must be TRUE):
  1. User sees a kanban board with four columns (To Do, In Progress, Review, Done) and can drag tasks between them
  2. User can create a new task with title, description, agent assignment, and priority from a form in the UI
  3. All 8 agents appear as status cards showing name, role, model, current status (active/idle/error), and last activity
  4. User can navigate tabs with number keys (1-8), open command bar with Cmd+K, and close modals with Escape
**Plans**: 2 plans (Wave 1: 01, Wave 2: 02)
**UI hint**: yes

Plans:
- [x] 02-01-PLAN.md — Kanban drag-and-drop + task detail editing (BOARD-01, BOARD-02, BOARD-03)
- [x] 02-02-PLAN.md — Agent status API + live cards + Cmd+K command bar + keyboard shortcuts (BOARD-04, BOARD-05, BOARD-06)

### Phase 3: Dispatch & Real-Time
**Goal**: Users can dispatch tasks to agents, watch work happen in real time, and kill runaway processes
**Depends on**: Phase 2
**Requirements**: DISP-01, DISP-02, DISP-03, DISP-04, DISP-05, DISP-06
**Success Criteria** (what must be TRUE):
  1. User can dispatch a task to any agent via the command bar and see the agent process start (using execFile, not shell exec)
  2. Activity feed updates in real time with agent-colored entries as agents work
  3. User can kill a running agent process from the UI and see it terminate
  4. Agent runs are recorded in SQLite with start time, duration, status, and outcome, and task status auto-updates on dispatch start and completion
**Plans**: 1 plan (Wave 1: 01)
**UI hint**: yes

Plans:
- [x] 03-01-PLAN.md — Backend dispatch engine + frontend dispatch UI, activity feed, kill switch (DISP-01 through DISP-06)

### Phase 4: Notifications & Viewers
**Goal**: Users receive actionable notifications from agent work and can view briefs, audits, portfolio data, cron schedules, and memory search results
**Depends on**: Phase 3
**Requirements**: NOTIF-01, NOTIF-02, NOTIF-03, NOTIF-04, NOTIF-05, NOTIF-06, NOTIF-07
**Success Criteria** (what must be TRUE):
  1. User sees an inbox with severity-tiered notifications (critical/warning/info) and can approve, dismiss, escalate, or view each item
  2. User can view the cron schedule as a table and a 24-hour SAST timeline showing all 7 cron jobs
  3. User can open and read rendered markdown for daily briefs (Scout), security audits (Sentinel), and portfolio reports (Broker)
  4. User can search the Karpathy memory wiki and browse results from the memory browser tab
**Plans**: 1 plan (Wave 1: 01)
**UI hint**: yes

Plans:
- [x] 04-01-PLAN.md — Notification inbox + cron timeline + brief/audit/portfolio viewers + memory browser (NOTIF-01 through NOTIF-07)

### Phase 5: Intelligence
**Goal**: Users can refine tasks through AI-assisted interviews before dispatch, and Jarvis automatically routes ambiguous tasks to the right sub-agent
**Depends on**: Phase 4
**Requirements**: INTEL-01, INTEL-02, INTEL-03, INTEL-04
**Success Criteria** (what must be TRUE):
  1. User can enter interview/shaping mode for a task and have a multi-turn conversation that refines the task description before dispatch
  2. When dispatching an ambiguous task, Jarvis evaluates it and routes to the best sub-agent automatically
  3. User can view per-project context panels showing docs, status, and history for each project
  4. User can see token/cost estimates per agent run (when OpenClaw exposes usage data)
**Plans**: 1 plan (Wave 1: 01)
**UI hint**: yes

Plans:
- [x] 05-01-PLAN.md — Interview shaping mode + Jarvis routing + project panels + cost tracking (INTEL-01 through INTEL-04)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | Complete | 2026-05-13 |
| 2. Board & Agents | 2/2 | Complete | 2026-05-13 |
| 3. Dispatch & Real-Time | 1/1 | Complete | 2026-05-13 |
| 4. Notifications & Viewers | 1/1 | Complete | 2026-05-13 |
| 5. Intelligence | 1/1 | Complete | 2026-05-13 |

All 5 phases of the v1.0 `milestone` shipped (each phase has a SUMMARY under
`.planning/phases/`). See "Post-milestone (v2.x)" below for where the project went next.

## Post-milestone (v2.x)

This roadmap covers the original 5-phase GSD milestone, which is **complete**. The
project has since advanced well beyond it into the "org chart + failover + working
core" era:

- **16-node org chart** (Jarvis CEO → 4 directors → 11 ICs) defined in
  `personalities/org-chart.json` and bootstrapped on boot.
- **Pluggable harness adapters** (`openclaw`, `claude`/`claude-code`, `hermes`,
  `cursor`, `codex`, `gemini`, `ollama`) with a **failover engine** that walks each
  agent's `harness_chain` on exhaustion and replays recent turns.
- **Watchdog** (`watchdog.py`), **cron scheduler**, **cleanup service**, **prompt
  guardrails** (canary tokens, jailbreak scan, token budgeting), and a
  **deep-research** decompose→investigate→synthesize pipeline.
- Currently **hardening into a "working core" release on the Node backend** with real
  streamed dispatch.

A **Python / FastAPI backend migration** exists under `src/visionary/` (scaffold +
read-only routes + dispatch/failover + comm fabric) but is **paused / frozen** as
future work — **ship Node** for the working-core release.
