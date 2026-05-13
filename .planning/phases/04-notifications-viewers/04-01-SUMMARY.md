---
phase: "04-notifications-viewers"
plan: "01"
subsystem: "notifications-viewers"
tags: [notifications, cron-timeline, markdown-viewer, memory-browser, inbox]
dependency_graph:
  requires: ["03-dispatch-realtime"]
  provides: ["notification-crud", "cron-viewer", "brief-viewer", "audit-viewer", "portfolio-viewer", "memory-search"]
  affects: ["server.js", "db.js", "sse.js", "public/app.js", "public/styles.css", "public/index.html"]
tech_stack:
  added: []
  patterns: ["list-detail-viewer", "regex-markdown-renderer", "severity-tiered-notifications", "24h-timeline-visualization"]
key_files:
  created: []
  modified: ["server.js", "db.js", "sse.js", "public/app.js", "public/styles.css", "public/index.html"]
decisions:
  - "Used hardcoded cron fallback when OpenClaw CLI unavailable"
  - "Regex-based markdown renderer instead of external library (zero-dep requirement)"
  - "List/detail pattern with closure state on container element for viewer navigation"
metrics:
  duration: "305s"
  completed: "2026-05-13T13:44:18Z"
---

# Phase 4 Plan 1: Notification Inbox + Cron Timeline + Viewers + Memory Browser Summary

Severity-tiered notification inbox with CRUD, cron schedule table with 24h SAST timeline, markdown-rendered viewers for briefs/audits/portfolio, and Karpathy memory wiki search browser.

## What Was Built

### Backend (Task 1)
- **6 notification prepared statements** in db.js: getNotifications, getUnreadCount, insertNotification, markNotificationRead, dismissNotification, getNotificationById
- **Auto-notification creation** on dispatch success (type: info) and failure (type: warning/error) in dispatchAgent()
- **GET /api/notifications** with limit parameter and unread count
- **PATCH /api/notifications/:id** supporting read/dismiss/escalate with action validation (T-04-01)
- **GET /api/crons** shelling out to `openclaw cron list --json` with hardcoded fallback schedule
- **GET /api/briefs** and **/api/briefs/:filename** reading daily-brief-*.md from workspace docs
- **GET /api/audits** and **/api/audits/:filename** reading audit markdown from workspace docs/audits
- **GET /api/portfolio** and **/api/portfolio/:filename** reading portfolio markdown from workspace docs/portfolio
- **GET /api/memory/search** running karpathy-memory.py with 15s timeout and 5MB buffer (T-04-04)
- **GET /api/memory** listing memory files with MEMORY.md detection
- **GET /api/memory/:filename** reading individual memory files
- **notification:created and notification:updated** SSE event wiring in sse.js
- **WORKSPACE constant** for ~/.openclaw/workspace path resolution
- **Path traversal prevention** on all filename parameters via `/^[a-zA-Z0-9._-]+\.md$/` regex (T-04-02)

### Frontend (Task 2)
- **9 nav tabs** in index.html: Board, Agents, Activity, Inbox, Crons, Briefs, Audits, Portfolio, Memory
- **renderInbox**: Severity-colored notifications (red=error, orange=warning, blue=action, green=info), filter bar, View/Dismiss/Escalate action buttons, unread badge, show/hide dismissed toggle
- **renderCrons**: Cron table with agent-colored badges + 24h SAST timeline with colored markers per agent and green "now" line
- **renderBriefs**: List/detail viewer for Scout daily briefs with markdown rendering
- **renderAudits**: List/detail viewer for Sentinel security audits with markdown rendering
- **renderPortfolio**: List/detail viewer for Broker portfolio reports with markdown rendering
- **renderMemory**: Search bar calling Karpathy wiki search with highlighted results + memory file browser with detail viewer
- **renderMarkdown + inlineFormat**: Regex-based markdown-to-HTML converter handling h1-h4, bold, italic, inline code, fenced code blocks, unordered/ordered lists, links, horizontal rules, paragraphs
- **Keyboard shortcuts 1-9** for all tab navigation
- **Command bar routes** /crons, /briefs, /audits, /portfolio, /memory
- **SSE listeners** for notification:created and notification:updated
- **onChange('notifications')** re-renders inbox on state change
- **loadNotifications()** added to init Promise.all

## Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Backend APIs | ce727e6 | db.js, sse.js, server.js |
| 2 | Frontend views | 4ebdd6c | public/index.html, public/app.js, public/styles.css |

## Deviations from Plan

None - plan executed exactly as written.

## Threat Mitigations Applied

| Threat ID | Status | Implementation |
|-----------|--------|----------------|
| T-04-01 | Mitigated | PATCH action validated against allowlist ['read', 'dismiss', 'escalate'] |
| T-04-02 | Mitigated | All filename params validated with `/^[a-zA-Z0-9._-]+\.md$/` regex |
| T-04-03 | Mitigated | All markdown text passes through esc() before HTML conversion |
| T-04-04 | Mitigated | 15s timeout + 5MB maxBuffer on python3 script execution, empty query rejected |
| T-04-05 | Accepted | Hardcoded cron fallback contains non-sensitive operational data |

## Known Stubs

None. All views are wired to real API endpoints.

## Requirements Coverage

- NOTIF-01: Notification inbox with severity tiers
- NOTIF-02: Notification action buttons (view, dismiss, escalate)
- NOTIF-03: Cron schedule table + 24h SAST timeline
- NOTIF-04: Scout daily briefs viewer
- NOTIF-05: Sentinel security audits viewer
- NOTIF-06: Broker portfolio reports viewer
- NOTIF-07: Karpathy memory wiki search + browser
