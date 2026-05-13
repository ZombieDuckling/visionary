---
phase: "05-intelligence"
plan: "01"
subsystem: "intelligence"
tags: ["interview", "routing", "projects", "cost-tracking", "jarvis"]
dependency_graph:
  requires: ["04-notifications-viewers"]
  provides: ["interview-api", "jarvis-routing", "project-crud", "cost-tracking"]
  affects: ["server.js", "db.js", "sse.js", "public/app.js", "public/styles.css", "public/index.html"]
tech_stack:
  added: ["interview-sessions-table", "token-columns"]
  patterns: ["multi-turn-cli-interview", "keyword-routing", "toast-notifications"]
key_files:
  created: []
  modified: ["server.js", "db.js", "sse.js", "public/app.js", "public/styles.css", "public/index.html"]
decisions:
  - "Used keyword matching for agent routing (not LLM-based) for speed and reliability"
  - "Interview sessions store full message history as JSON in SQLite"
  - "Cost estimation uses fixed per-token pricing (Claude Sonnet vs Llama)"
  - "Command bar auto-routes long text (>20 chars) instead of creating unassigned tasks"
metrics:
  duration: "~15 minutes"
  completed: "2026-05-13"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 6
---

# Phase 5 Plan 1: Intelligence Features Summary

Multi-turn Jarvis interview mode with auto-routing, project CRUD, and token cost tracking across all agent runs.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Backend: DB migration, interview API, project CRUD, routing, tokens | 498209a | db.js, server.js, sse.js |
| 2 | Frontend: Interview overlay, Projects tab, toast, cost display | 498209a | public/app.js, public/index.html, public/styles.css |
| 3 | Integration wiring: agents cost data, dispatch auto-routing, smoke test | 498209a | server.js |

## What Was Built

### INTEL-01: Interview/Shaping Mode
- `POST /api/interview/start` creates session, calls Jarvis via OpenClaw CLI for first question
- `POST /api/interview/:id/reply` sends user answer, gets Jarvis follow-up or refined task
- `POST /api/interview/:id/dispatch` dispatches the refined task to suggested agent
- `GET /api/interview/:id` returns session with parsed messages
- Frontend chat overlay with bubbles, typing indicator, and dispatch-ready banner
- "Shape with Jarvis" button on task creation form and task detail overlay
- Interview sessions table with messages_json, refined_title, refined_description, suggested_agent

### INTEL-02: Jarvis Auto-Routing
- `routeToAgent(description)` function with keyword matching across 7 specialist agents + jarvis default
- Returns agent_id, confidence (high/medium/low), and matched_keywords
- POST /api/dispatch auto-routes when no agent_id specified (replaces previous error)
- Explicit `auto_route: true` flag support for re-routing away from jarvis
- Command bar: `@jarvis route: <msg>` triggers auto-routing
- Command bar: plain text >20 chars auto-routes instead of creating unassigned task
- Toast notification shows routing result with agent and confidence

### INTEL-03: Projects Tab
- GET /api/projects returns all projects with task_count and active_task_count
- GET /api/projects/:id returns project with tasks, runs, and workspace docs
- POST /api/projects creates project with slug generation
- PATCH /api/projects/:id updates project fields
- Frontend: 10th nav tab with project grid, detail view (tasks/runs/docs), create/edit forms
- Color swatch picker with 6 preset colors
- Keyboard shortcut 0 for Projects tab

### INTEL-04: Token/Cost Tracking
- agent_runs table gains input_tokens, output_tokens, estimated_cost_usd columns
- Token parsing from OpenClaw CLI JSON output (usage/token_usage/metrics fields)
- Cost estimation: Claude Sonnet pricing vs Llama pricing based on agent model
- GET /api/agents includes last_run_cost per agent
- Agent cards display cost badge when data available
- Project detail runs show cost per run

## Security Mitigations Applied

| Threat ID | Mitigation |
|-----------|------------|
| T-05-01 | Interview messages passed via execFile (no shell injection), capped at 2000 chars |
| T-05-02 | Project names use parameterized SQL, slug strips non-alphanumeric |
| T-05-03 | Project doc directory validated with regex + startsWith path check |
| T-05-04 | 30s timeout on Jarvis CLI calls, max 20 messages per interview session |
| T-05-06 | Session ID validated as integer, messages managed server-side only |

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None - all features are fully wired end-to-end.

## Self-Check: PASSED
