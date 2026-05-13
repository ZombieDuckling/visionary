# Feature Landscape

**Domain:** Agent orchestration dashboard + project management (single-user ops center)
**Researched:** 2026-05-13

## Competitive Landscape Surveyed

| Platform | Type | Key Lesson for Visionary |
|----------|------|--------------------------|
| Mission Control (builderz-labs) | Self-hosted agent orchestration | Closest competitor — kanban + agent dispatch + real-time telemetry, SQLite-backed |
| CrewAI Enterprise | Agent orchestration SaaS | Drag-and-drop crew building, real-time tracing, lifecycle management |
| AutoGen Studio | Agent IDE | Build/playground/gallery split; declarative agent config; debug console |
| LangGraph Studio | Agent IDE | Graph visualization, state inspection, mid-execution intervention |
| n8n | Workflow automation | 500+ integrations, human-in-the-loop approvals, inline execution logs |
| Retool Agents | Low-code agent platform | Agent eval/testing, cost monitoring, MCP integration |
| Linear | Project management | Speed-first UX, keyboard-driven, minimal clutter, opinionated workflows |
| Notion | Project management | Multi-view databases (kanban/timeline/calendar/list), relational data |
| Cline Kanban | Agent task board | Agent-aware kanban with auto-assignment and role-based routing |

## Table Stakes

Features users expect from a daily-driver agent ops center. Missing any of these and the dashboard feels like a toy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Agent status cards** | Must see at a glance which agents are alive, idle, working, or errored | Low | Show agent name, current task, last heartbeat, status badge. Every platform does this. |
| **Task dispatch to agents** | Core value prop — send work to agents without terminal | Low | Command bar or click-to-dispatch. Must map to `openclaw agent --agent <id> --message` |
| **Task list/board view** | Standard PM expectation — see all work items and their state | Medium | Kanban (To Do / In Progress / Review / Done) is the baseline. Linear, Mission Control, and every PM tool has this. |
| **Real-time activity feed** | Agents work asynchronously; need to see what happened while you were away | Medium | Timestamped, agent-colored entries. WebSocket/SSE push, not polling. Mission Control and CrewAI both stream live. |
| **Task creation with metadata** | Must create tasks with priority, agent assignment, description | Low | Priority levels, agent assignment, due dates. Table stakes in every PM tool. |
| **Agent run history/logs** | Need to see what an agent did, not just that it finished | Medium | Per-agent log viewer showing task input, actions taken, output. AutoGen has debug console, LangGraph has trace view. |
| **Persistent storage** | Data must survive restarts | Low | SQLite is the right call. Every serious dashboard persists state. |
| **Notification/inbox center** | Agents produce outputs that need human attention (approvals, reviews, alerts) | Medium | Actionable items with approve/dismiss/escalate. Mission Control has coordinator inbox. n8n has human-in-the-loop. |
| **Cron/schedule visibility** | 7 cron jobs running — need to see what fires when | Low | Timeline or table showing next/last run, status. n8n shows workflow schedules. |
| **Dark theme ops-center aesthetic** | This is a command center, not a SaaS app. The aesthetic IS the product for a single-user tool. | Low | Bloomberg Terminal meets sci-fi. Monospace. High information density. Already specified in PROJECT.md. |
| **Keyboard shortcuts** | Power users (Josh) will not click through menus | Low | Linear's killer feature. Cmd+K command palette, vim-style navigation. Non-negotiable for daily driver. |
| **Search** | Must find tasks, agent outputs, logs quickly | Medium | Full-text search across tasks, logs, agent outputs. Notion and Linear both have excellent search. |

## Differentiators

Features that set Visionary apart from generic agent dashboards. Not expected, but create significant value.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Interview/shaping mode** | AI-assisted task refinement before dispatch. No other agent dashboard does pre-dispatch task shaping. You describe intent, the system interviews you to build a complete brief. | High | This is Visionary's signature feature. Bridges the gap between "I want X" and a well-structured agent task. Closest analog is n8n's AI Workflow Builder, but that builds workflows not tasks. |
| **Orchestrator routing (Jarvis decides)** | Submit ambiguous tasks and Jarvis routes to the right sub-agent automatically. User doesn't need to know which agent handles what. | Medium | CrewAI has crew orchestration, but it's for pre-defined workflows. This is dynamic — Jarvis evaluates the task and picks. More like a dispatcher than a pipeline. |
| **Unified project context panels** | Per-project view aggregating docs, agent history, outputs, deployments, briefs — everything about a project in one place. | Medium | No agent dashboard does this well. PM tools (Notion, Linear) have project views but don't integrate agent outputs. This bridges PM and agent orchestration. |
| **Memory/wiki browser with semantic search** | Browse and search the Karpathy memory wiki (571 chunks) directly from the dashboard. Agents' institutional knowledge, visible and searchable. | Medium | Unique to OpenClaw's architecture. No competitor has an in-dashboard knowledge base browser with semantic search. |
| **Daily brief / report viewers** | Dedicated viewers for Scout's morning briefs, Sentinel's security audits, Broker's portfolio updates. Not just logs — formatted, readable output panels. | Low | These are high-value agent outputs that deserve first-class rendering, not buried in a log stream. |
| **Sub-agent spawning from tasks** | Click a task, spawn a sub-agent inline. See the parent task create child tasks as the agent breaks work down. | Medium | Mission Control mentions inline sub-agent spawning. LangGraph allows mid-execution intervention. Combining both — spawn from kanban, watch decomposition live — is powerful. |
| **Cost/token tracking per agent and task** | See how much each agent costs, per task and over time. Budgets and alerts. | Medium | Retool and Sentry dashboards track tokens/cost. Critical for managing 8 agents with daily crons — costs add up fast. |
| **Agent trust/performance scoring** | Track agent reliability over time — success rate, quality of output, time to complete. Surfaces which agents are performing well. | Medium | Mission Control has trust scoring. Builds confidence in delegation over time. |

## Anti-Features

Features to explicitly NOT build. Each represents a trap that would waste effort or harm the product.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Drag-and-drop workflow builder** | CrewAI and n8n's core feature, but Visionary is an ops center, not a workflow designer. Josh's agents are already configured in OpenClaw. Building a visual workflow editor is months of work for a feature that duplicates existing CLI config. | Dispatch tasks to pre-configured agents. If workflow changes are needed, edit OpenClaw config files directly. |
| **Multi-user auth/RBAC** | Single user (Josh). Building auth, roles, permissions is pure overhead. Mission Control has RBAC because it targets teams. | Hardcode single-user. Add basic session token if exposed beyond localhost, but no user management. |
| **Agent builder/configuration UI** | AutoGen Studio's build mode lets you configure agents visually. But Josh's agents are defined in AGENTS.md and OpenClaw config. A config UI adds complexity without value. | Read agent config from OpenClaw. Display it, don't edit it. Agents are configured in code/config, not in the dashboard. |
| **Chat-based agent interaction** | Retool and AutoGen have chat UIs. But chat is the wrong metaphor for task dispatch — it implies conversation, not command. Josh already has WhatsApp for Jarvis chat. | Command bar for dispatch. Structured task forms for complex work. Interview mode for shaping. Reserve chat for WhatsApp. |
| **Plugin/extension marketplace** | n8n has 500+ integrations. Building a plugin system is enormous scope and irrelevant for a single-user tool. | Hardcode integrations to OpenClaw, the wiki, and the filesystem. Add specific integrations (GitHub, etc.) as later milestones when needed. |
| **Mobile native app** | Responsive web covers mobile use cases. Native app is months of work for marginal benefit. | Ensure the web UI is responsive. PWA with home screen icon if needed. |
| **AI-powered dashboard building** | Retool lets AI build dashboard components. Meta-complexity — you'd be building AI to build your AI dashboard. | Build the dashboard by hand. It's a fixed set of views for a single user. |
| **Collaborative editing / comments** | Notion-style collaborative docs. Single user, no audience for collaboration features. | Simple notes field on tasks. Markdown rendering for agent outputs. |
| **Complex reporting/analytics** | Jira-style burndown charts, velocity tracking, sprint analytics. Overhead for a single developer managing agents. | Simple counters: tasks completed this week, agent utilization, cost this month. No charts-for-charts-sake. |

## Feature Dependencies

```
Persistent Storage (SQLite) ──> Everything else depends on this
     |
     ├──> Agent Status Cards (need DB for heartbeat/state tracking)
     ├──> Task List/Board (need DB for task CRUD)
     │      ├──> Task Dispatch (need tasks to exist before dispatching)
     │      ├──> Task Creation with Metadata
     │      └──> Sub-agent Spawning (needs parent task context)
     ├──> Activity Feed (needs DB for event log)
     │      └──> Real-time Push (WebSocket/SSE layer on top of feed)
     ├──> Notification Inbox (needs DB for notification queue)
     ├──> Agent Run History (needs DB for run logs)
     │      └──> Cost/Token Tracking (extends run history with token counts)
     │      └──> Agent Trust Scoring (computed from run history)
     ├──> Cron Schedule View (reads from OpenClaw config, displays in UI)
     ├──> Search (full-text index over tasks, logs, outputs)
     └──> Memory Browser (reads wiki, needs semantic search endpoint)

Interview/Shaping Mode ──> Requires Task Creation + Agent Dispatch (produces a task, then dispatches it)
Orchestrator Routing ──> Requires Agent Dispatch + Jarvis agent available
Project Context Panels ──> Requires Task Board + Agent Run History + file system access
Daily Brief Viewers ──> Requires file system access to workspace output files
```

## MVP Recommendation

**Build in this order for fastest path to daily-driver status:**

### Phase 1: Foundation (replace current dashboard)
1. **Persistent SQLite storage** — schema for tasks, agents, runs, events
2. **Agent status cards** — live heartbeat from OpenClaw CLI
3. **Task creation + list view** — CRUD with priority and agent assignment
4. **Task dispatch** — command bar sending to OpenClaw agents
5. **Keyboard shortcuts** — Cmd+K palette from day one

### Phase 2: Visibility (see what agents are doing)
6. **Real-time activity feed** — SSE-pushed event stream
7. **Agent run history/logs** — per-agent log viewer
8. **Cron schedule view** — 24h SAST timeline
9. **Daily brief / audit viewers** — formatted output panels

### Phase 3: Intelligence (the differentiators)
10. **Kanban board** — drag-and-drop with column transitions
11. **Notification inbox** — actionable items from agent outputs
12. **Interview/shaping mode** — AI-assisted task refinement
13. **Orchestrator routing** — Jarvis as smart dispatcher

### Defer to later milestones:
- **Memory browser** — valuable but not blocking daily use
- **Project context panels** — needs more data accumulated first
- **Cost/token tracking** — add once agent usage is heavy enough to matter
- **Agent trust scoring** — needs historical data to be meaningful
- **Search** — add when volume of tasks/logs makes manual browsing impractical

## Sources

- [Mission Control by builderz-labs](https://github.com/builderz-labs/mission-control) — self-hosted agent orchestration, SQLite, kanban, real-time telemetry
- [CrewAI Platform](https://crewai.com/) — drag-and-drop crew building, tracing, lifecycle management
- [AutoGen Studio](https://microsoft.github.io/autogen/stable//user-guide/autogenstudio-user-guide/index.html) — build/playground/gallery, declarative agent config
- [LangGraph Studio](https://blog.langchain.com/langgraph-studio-the-first-agent-ide/) — graph visualization, state inspection, execution monitoring
- [n8n AI Agents](https://n8n.io/ai-agents/) — workflow automation, human-in-the-loop, inline logs
- [Retool Agents](https://retool.com/agents) — agent eval/testing, cost monitoring, MCP integration
- [Linear](https://linear.app/) — speed-first UX, keyboard shortcuts, minimal clutter
- [Notion Projects](https://www.notion.com/product/projects) — multi-view databases, relational data, timeline
- [Sentry AI Agent Observability](https://blog.sentry.io/ai-agent-observability-developers-guide-to-agent-monitoring/) — agent dashboard metrics, token tracking, cost projections
- [Agent Kanban (saltbo)](https://github.com/saltbo/agent-kanban) — agent-first task board with auto-assignment
- [Cline Kanban](https://cline.bot/kanban) — orchestrate coding agents with kanban
