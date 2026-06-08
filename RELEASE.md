# Visionary Mission Control — Release Runbook

Last verified: 2026-06-08

## Purpose

This runbook is the shortest reliable path from a dirty dev tree to a local production-ready Visionary build.

## Local runtime

- Node: 22.x
- Host: macOS Apple Silicon
- Server bind: `127.0.0.1`
- Default port: `3333`
- Override port: `VISIONARY_PORT=3399 node server.js`
- Default DB: `./visionary.sqlite`
- Override DB: `VISIONARY_DB=/tmp/visionary-smoke.sqlite node server.js`

## Pre-flight

```bash
cd /Users/joshuasack/Projects/visionary
hermes gateway status
hermes cron status
openclaw doctor
openclaw agent --local --agent main --message 'health check: reply with OK only' --json --timeout 60
```

Required healthy signals:

- Hermes gateway is running so scheduled orchestrator jobs fire.
- Hermes cron status says cron jobs will fire automatically.
- OpenClaw can execute a short local agent health check.
- `http://127.0.0.1:3333/api/orchestrator` reports the persistent Hermes orchestrator.

## Verification gate

```bash
npm run verify
```

Expected:

- `npm run check` passes syntax checks for server/frontend/core JS files.
- `npm run smoke` passes all `node:test` smoke tests against an isolated DB and port.

## Local unsigned app build

Use unsigned/ad-hoc packaging until Apple signing identities are cleaned up:

```bash
npm run build:unsigned
```

Expected artifact:

```text
dist/mac-arm64/Visionary.app
```

`build:unsigned` deliberately disables normal signing identity discovery and rebuilds `better-sqlite3` afterward for the Node runtime.

## Manual browser QA

Start or restart the server:

```bash
VISIONARY_PORT=3333 node server.js
```

Open:

```text
http://127.0.0.1:3333/#/overview
```

Check:

- Overview loads with no browser console errors.
- Hermes persistent orchestrator panel is visible.
- Dashboard missions show actionable next work.
- `/api/overview` returns JSON.
- `/api/orchestrator` returns JSON and shows gateway/cron health.
- Board, Agents, Activity, Inbox, Crons, Briefs, Audits, Portfolio, Memory, Projects routes render.

## Persistent orchestrator

Hermes gateway must be installed as a launchd service for cron jobs to fire in the background:

```bash
hermes gateway install
hermes gateway status
hermes cron status
```

Current orchestrator job:

```text
job_id: 7559594abe69
name: Visionary production-readiness overnight orchestrator
schedule: every 30m
workdir: /Users/joshuasack/Projects/visionary
```

## Known non-blocking warnings

- Normal signed `npm run build` can fail when macOS sees duplicate/ambiguous Apple Development identities. Use `npm run build:unsigned` for local release candidates.
- OpenCode and Cursor harnesses may show unavailable until credentials/models are configured.
- OpenClaw doctor may warn about optional memory embedding providers; that does not block dashboard dispatch if `openclaw agent --local ...` succeeds.

## Rollback

If a change breaks the dashboard:

```bash
git diff --stat
npm run verify
```

Then revert only the failing files or restore from the last clean commit. Avoid deleting `visionary.sqlite` unless intentionally resetting local dashboard state.
