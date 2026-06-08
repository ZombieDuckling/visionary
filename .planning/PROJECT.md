# Visionary Mission Control

## What This Is

A custom web-based project management and agent orchestration platform for the user's OpenClaw multi-agent system. Upgrades the current static Node.js dashboard into a full interactive operations center — inspired by Benoît's "Visionary" platform but adapted for the user's 8-agent cybersecurity/builder/investment setup.

## Core Value

**One place to see everything your agents are doing, dispatch work, and manage projects — without juggling Telegram/WhatsApp/terminal.**

## What It Looks Like

An operations center with:
- A Kanban board where tasks flow through To Do → In Progress → Review → Done
- Agent desk cards showing live status, what each agent is working on
- A command bar to dispatch any task to any agent instantly
- An inbox with actionable notifications (approve PRs, view briefs, merge, dismiss)
- An interview/shaping mode that helps you define tasks before dispatching
- Real-time activity feed showing agent work as it happens
- Project context panels with docs, deployments, PRs per project

## Context

### Existing System (what we're building on)
- 8 OpenClaw agents: Jarvis (main), Scout, Analyst, Forge, Sentinel, Broker, Ops, Hunter
- 7 cron jobs (morning brief, daily build, security audits 2x, wiki reindex, LinkedIn 2x)
- Karpathy memory wiki with 571 chunks, semantic search via nomic-embed-text
- Current Node.js dashboard server (server.js, port 3333) with 8 tabs, basic agent cards, task dispatch via POST /api/task
- WhatsApp channel for Jarvis
- OpenClaw gateway on port 18789
- Workspace at ~/.openclaw/workspace with SOUL.md, AGENTS.md, TEAM.md, PROJECTS.md, MEMORY.md, etc.

### Tech Stack
- **Runtime:** Node.js (zero external npm dependencies — stdlib only for server)
- **Database:** SQLite via better-sqlite3 (single npm dependency — persistent task/agent tracking)
- **Frontend:** Single HTML SPA embedded in server.js template literal
- **Agent dispatch:** OpenClaw CLI (`openclaw agent --agent <id> --message "text" --json`)
- **Data sources:** OpenClaw CLI JSON output (health, agents, crons), workspace files (briefs, audits, memory)
- **Design:** Dark ops-center aesthetic, monospace, Bloomberg Terminal meets sci-fi command center

### User
- the user — builder/developer/cybersecurity expert in South Africa (Africa/Johannesburg timezone)
- Wants high autonomy, speed, practical execution
- Uses this daily to manage agents, projects, investments, job hunting, security

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Kanban board with drag-and-drop task management (To Do, In Progress, Review, Done)
- [ ] Task creation with agent assignment and priority
- [ ] Agent spawning from tasks — click to dispatch, see live progress
- [ ] Orchestrator pattern — Jarvis decides which sub-agent handles complex tasks
- [ ] Live agent status cards showing current activity, last action, uptime
- [ ] Inbox/notification center with actionable items (approve, dismiss, escalate)
- [ ] Interview/shaping mode — AI interviews you to refine a task before dispatch
- [ ] Persistent SQLite database for tasks, agent runs, notifications, outcomes
- [ ] Real-time activity feed with agent-colored entries
- [ ] Command bar for quick task dispatch to any agent
- [ ] Cron schedule view with 24h SAST timeline
- [ ] Daily brief viewer (Scout output)
- [ ] Security audit viewer (Sentinel output)
- [ ] Portfolio/financial viewer (Broker output)
- [ ] Memory browser with wiki search integration
- [ ] Project context panels (per-project docs, status, history)

### Out of Scope

- GitHub PR integration with merge buttons — later milestone
- Phone push notifications (Burr/webhook) — later milestone
- Linear/Jira external tool integrations (Composio) — later milestone
- Tailscale/VPN secure remote access — later milestone
- Multi-user auth — single user (the user) only
- Mobile native app — responsive web is sufficient
- Voice commands — later milestone

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| SQLite over Convex | Zero infrastructure, single file, works offline, no account needed | Pending |
| Single server.js file | Existing pattern works, zero-dep, easy to maintain | Pending |
| Embedded HTML SPA | No build step, no React/Vue overhead, instant iteration | Pending |
| better-sqlite3 as only npm dep | Best SQLite binding for Node, synchronous API, fast | Pending |
| Upgrade existing dashboard | Don't rebuild from scratch — evolve what's working | Pending |

---
*Last updated: 2026-05-13 after initialization*
