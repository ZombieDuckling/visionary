---
phase: "03-dispatch-realtime"
plan: "01"
subsystem: "dispatch-engine"
tags: [dispatch, openclaw, sse, kill-switch, activity-feed, agent-runs]
dependency_graph:
  requires: ["02-board-agents"]
  provides: ["dispatch-api", "kill-switch", "activity-feed", "agent-run-tracking"]
  affects: ["server.js", "db.js", "sse.js", "public/app.js", "public/styles.css"]
tech_stack:
  added: ["child_process.execFile"]
  patterns: ["in-memory process tracking", "CLI output sanitization", "SSE dispatch lifecycle"]
key_files:
  created: []
  modified:
    - server.js
    - db.js
    - sse.js
    - public/app.js
    - public/styles.css
decisions:
  - "Used execFile over exec to prevent shell injection (T-03-01 mitigation)"
  - "Agent configs moved to module level for dispatch validation + GET /api/agents shared use"
  - "activeDispatches Map keyed by runId for O(1) kill switch lookup"
  - "SIGTERM first with 5s SIGKILL fallback for kill switch"
  - "Command bar @agent dispatch creates task + dispatches in single API call"
metrics:
  duration: "287s"
  completed: "2026-05-13"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 5
---

# Phase 03 Plan 01: Agent Dispatch Engine + Activity Feed + Kill Switch Summary

OpenClaw CLI dispatch via safe child_process API with in-memory process tracking, real-time SSE lifecycle events, kill switch, and agent-colored activity feed.

## Tasks Completed

| Task | Name | Commit | Key Changes |
|------|------|--------|-------------|
| 1 | Backend dispatch engine | 5e514be | CLI wrapper, POST /api/dispatch, POST /api/dispatch/:runId/kill, GET /api/runs, DB statements, SSE event wiring, heartbeat interval, graceful shutdown |
| 2 | Frontend dispatch UI | 5e514be | Command bar @agent dispatch, task detail Dispatch button, activity feed with agent colors, agent card kill switch, task running indicator, activeRuns state + SSE listeners |

## Implementation Details

### Backend (server.js, db.js, sse.js)

- **dispatchAgent()**: Transaction-based function that updates task to in_progress, inserts agent_run record, emits SSE events, then spawns openclaw CLI safely (no shell)
- **POST /api/dispatch**: Three modes -- dispatch existing task (task_id), create+dispatch (agent_id + message), or error
- **POST /api/dispatch/:runId/kill**: SIGTERM with 5s SIGKILL fallback, updates DB + SSE
- **GET /api/runs**: Returns run history, filterable by task_id
- **activeDispatches Map**: Tracks {process, agentId, taskId, startTime} per runId
- **stripAnsi + cleanCliOutput**: Strips ANSI escape codes and [plugins] warning lines before JSON.parse
- **Heartbeat**: 5s interval broadcasts agent:progress with elapsed_ms for all active dispatches
- **Graceful shutdown**: SIGINT/SIGTERM kill all active child processes before closing

### Frontend (public/app.js, public/styles.css)

- **Command bar**: @agent message now calls POST /api/dispatch (creates task + dispatches), plain text still creates task only
- **Task detail**: Dispatch button sends POST /api/dispatch with task_id and selected agent
- **Activity feed**: Agent-colored left borders, agent badges with color-mix backgrounds, event-type-specific badge colors
- **Agent cards**: Running indicator with spinner, elapsed time, and Kill button for active dispatches
- **Task cards**: Spinner indicator when dispatch is in progress
- **SSE listeners**: agent:started/completed/failed/progress update activeRuns state, trigger re-renders

### Security Mitigations (from threat model)

- T-03-01: Safe child process spawning prevents shell injection; agent_id validated against hardcoded allowlist
- T-03-02: 660s hard timeout, 10MB maxBuffer, kill switch UI, heartbeat monitoring, graceful shutdown
- T-03-03: All agent output passes through esc() before innerHTML; stored as plain text
- T-03-04: stripAnsi + [plugins] filter + try/catch JSON.parse with raw text fallback

## Deviations from Plan

None - plan was followed exactly as written.

## Known Stubs

None - all data paths are wired to real API endpoints and SSE events.

## Self-Check: PASSED

- All 5 modified files exist on disk
- Commit 5e514be verified in git log
- 15/15 frontend checks passed
- All backend DB/SSE/server checks passed
- Syntax validation clean for server.js and app.js
