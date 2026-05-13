# Requirements — Visionary Mission Control

## v1 Requirements

### Foundation (FOUND)
- [x] **FOUND-01**: Server serves HTML dashboard from separate file (not template literal)
- [x] **FOUND-02**: SQLite database with WAL mode, migrations, and 5-table schema (projects, tasks, agent_runs, notifications, activity_log)
- [x] **FOUND-03**: Proxy-based reactive state store in frontend with one-way data flow
- [x] **FOUND-04**: Dark ops-center design system (tokens, typography, spacing, component primitives)
- [x] **FOUND-05**: REST API with JSON responses for all CRUD operations
- [x] **FOUND-06**: SSE endpoint for real-time push updates to browser

### Board & Agents (BOARD)
- [x] **BOARD-01**: Kanban board with columns: To Do, In Progress, Review, Done
- [x] **BOARD-02**: Drag-and-drop task movement between columns via HTML5 DnD API
- [x] **BOARD-03**: Task creation with title, description, agent assignment, priority
- [x] **BOARD-04**: Agent status cards showing name, role, model, last activity, current status
- [x] **BOARD-05**: Agent desk grid with live status indicators (active/idle/error)
- [x] **BOARD-06**: Keyboard shortcuts for power users (1-8 tabs, Cmd+K command bar, Escape close)

### Dispatch & Real-Time (DISP)
- [ ] **DISP-01**: Agent dispatch via OpenClaw CLI (execFile, not exec — no shell injection)
- [ ] **DISP-02**: Command bar for quick dispatch to any agent with dropdown selector
- [ ] **DISP-03**: Kill switch to terminate runaway agent processes
- [ ] **DISP-04**: Real-time activity feed with agent-colored entries via SSE
- [ ] **DISP-05**: Agent run tracking with start time, duration, status, outcome in SQLite
- [ ] **DISP-06**: Task status auto-updates when agent dispatch starts and completes

### Notifications & Viewers (NOTIF)
- [ ] **NOTIF-01**: Inbox with severity-tiered notifications (critical/warning/info)
- [ ] **NOTIF-02**: Actionable notification buttons (approve, dismiss, escalate, view)
- [ ] **NOTIF-03**: Cron schedule view with table and 24h SAST timeline visualization
- [ ] **NOTIF-04**: Daily brief viewer rendering Scout markdown output
- [ ] **NOTIF-05**: Security audit viewer rendering Sentinel markdown output
- [ ] **NOTIF-06**: Portfolio viewer rendering Broker markdown output
- [ ] **NOTIF-07**: Memory browser with Karpathy wiki search integration

### Intelligence (INTEL)
- [ ] **INTEL-01**: Interview/shaping mode — AI interviews user to refine task before dispatch
- [ ] **INTEL-02**: Jarvis orchestrator routing — auto-select best agent for a task based on content
- [ ] **INTEL-03**: Project context panels with per-project docs, status, and history
- [ ] **INTEL-04**: Token/cost estimation per agent run (if OpenClaw exposes usage data)

## v2 Requirements (Deferred)

- GitHub PR integration with merge buttons
- Phone push notifications via webhook
- Linear/Jira external integrations (Composio)
- Tailscale secure remote access
- Multi-user auth
- Voice commands
- Mobile native app

## Out of Scope

- Drag-and-drop workflow builder (duplicates OpenClaw config, months of work)
- Chat-based interaction (WhatsApp already exists for this)
- Multi-user/team features (single user: Josh)
- Custom LLM provider management (OpenClaw handles this)

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| FOUND-01 | Phase 1 | Complete |
| FOUND-02 | Phase 1 | Complete |
| FOUND-03 | Phase 1 | Complete |
| FOUND-04 | Phase 1 | Complete |
| FOUND-05 | Phase 1 | Complete |
| FOUND-06 | Phase 1 | Complete |
| BOARD-01 | Phase 2 | Complete |
| BOARD-02 | Phase 2 | Complete |
| BOARD-03 | Phase 2 | Complete |
| BOARD-04 | Phase 2 | Complete |
| BOARD-05 | Phase 2 | Complete |
| BOARD-06 | Phase 2 | Complete |
| DISP-01 | Phase 3 | Pending |
| DISP-02 | Phase 3 | Pending |
| DISP-03 | Phase 3 | Pending |
| DISP-04 | Phase 3 | Pending |
| DISP-05 | Phase 3 | Pending |
| DISP-06 | Phase 3 | Pending |
| NOTIF-01 | Phase 4 | Pending |
| NOTIF-02 | Phase 4 | Pending |
| NOTIF-03 | Phase 4 | Pending |
| NOTIF-04 | Phase 4 | Pending |
| NOTIF-05 | Phase 4 | Pending |
| NOTIF-06 | Phase 4 | Pending |
| NOTIF-07 | Phase 4 | Pending |
| INTEL-01 | Phase 5 | Pending |
| INTEL-02 | Phase 5 | Pending |
| INTEL-03 | Phase 5 | Pending |
| INTEL-04 | Phase 5 | Pending |
