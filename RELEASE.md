# Visionary Mission Control — Release Runbook

Last verified: 2026-06-08

## Purpose

This runbook is the reliable path from a dirty dev tree to a locally usable Visionary release candidate. It covers both supported ways to run Visionary:

- Browser mode: Node server on `127.0.0.1`, opened in a normal browser.
- Electron mode: native macOS Electron shell that starts the same Node server and opens a desktop window.

This project is local-first. Do not bind the server to public interfaces for release QA.

## Local runtime

- Host: macOS Apple Silicon.
- Node: 22.x.
- Server bind: `127.0.0.1` only.
- Default port: `3333`.
- Override port: `VISIONARY_PORT=3399 node server.js`.
- Default DB: `./visionary.sqlite`.
- Override DB: `VISIONARY_DB=/tmp/visionary-smoke.sqlite node server.js`.
- Workspace default: `$HOME/.openclaw/workspace`.
- Electron entrypoint: `electron.js`.
- Packaged app artifact: `dist/mac-arm64/Visionary.app`.

Important Electron limitation: `electron.js` currently loads `http://127.0.0.1:3333` directly. For Electron mode, keep port `3333` unless the Electron entrypoint is updated to read `VISIONARY_PORT` for its `APP_URL`.

## Release modes

### Browser mode

Browser mode is the fastest and most transparent release validation path. It runs the production server directly and opens the SPA in a regular browser.

Use browser mode when:

- validating server/API behavior;
- checking console errors with normal browser devtools;
- testing against a temporary SQLite database;
- debugging OpenClaw/Hermes runtime integration.

Command:

```bash
cd /Users/joshuasack/Projects/visionary
VISIONARY_PORT=3333 node server.js
open http://127.0.0.1:3333/#/overview
```

Optional clean smoke DB:

```bash
VISIONARY_DB=/tmp/visionary-release-smoke.sqlite VISIONARY_PORT=3333 node server.js
open http://127.0.0.1:3333/#/overview
```

Stop with `Ctrl-C` in the server terminal.

### Electron mode

Electron mode wraps the same server in a native desktop window. It launches `server.js` through `electron.js`, waits for the `running at` log line or a 3-second fallback, then loads `http://127.0.0.1:3333`.

Use Electron mode when:

- validating native window behavior;
- checking the packaged app artifact;
- reproducing desktop-only issues;
- testing that the server starts correctly from inside the app bundle.

Development Electron run:

```bash
cd /Users/joshuasack/Projects/visionary
npm run app
```

If Electron cannot find the intended Node runtime, force it:

```bash
VISIONARY_NODE=/opt/homebrew/bin/node npm run app
# or, for nvm installs:
VISIONARY_NODE=$HOME/.nvm/versions/node/v22.22.0/bin/node npm run app
```

Packaged Electron run after `npm run build:unsigned`:

```bash
open dist/mac-arm64/Visionary.app
```

If the app opens a blank window, first confirm the server is reachable in a browser at `http://127.0.0.1:3333/#/overview`, then inspect Electron logs by launching from Terminal:

```bash
dist/mac-arm64/Visionary.app/Contents/MacOS/Visionary
```

## Pre-flight

Run these from the repo root:

```bash
cd /Users/joshuasack/Projects/visionary
git status --short
node --version
npm --version
hermes gateway status
hermes cron status
openclaw doctor
openclaw agent --local --agent main --message 'health check: reply with OK only' --json --timeout 60
```

Required healthy signals:

- Node is 22.x.
- Hermes gateway is running so scheduled orchestrator jobs fire.
- Hermes cron status says cron jobs will fire automatically.
- OpenClaw can execute a short local agent health check.
- `http://127.0.0.1:3333/api/orchestrator` reports the persistent Hermes orchestrator when the server is running.

If the git tree is dirty, review `git diff --stat` before packaging so release changes are intentional.

## Verification gate

Always run verification before packaging:

```bash
npm run verify
```

Expected:

- `npm run check` passes syntax checks for server/frontend/core JS files.
- `npm run smoke` passes all `node:test` smoke tests against an isolated DB and port.

Current scripts:

```bash
npm run check      # node --check server.js db.js sse.js electron.js public/app.js
npm run smoke      # node --test tests/smoke.mjs
npm run verify     # check + smoke
```

## SQLite and native module rebuilds

Visionary uses `better-sqlite3`, a native Node addon. Native addons are ABI-sensitive, so the build can fail or the packaged app can fail at runtime if `better-sqlite3` was compiled for the wrong runtime.

Normal local Node rebuild:

```bash
npm run rebuild:node
```

Equivalent direct command:

```bash
npm rebuild better-sqlite3
```

When to rebuild:

- after installing or upgrading Node;
- after installing or upgrading Electron;
- after `electron-builder` packages native modules;
- after seeing `better_sqlite3.node` load errors;
- after switching between system Node, Homebrew Node, and nvm Node.

Expected package script behavior:

```bash
npm run build:unsigned   # packages app, then runs npm run rebuild:node
npm run dist:unsigned    # packages dmg, then runs npm run rebuild:node
```

Why rebuild after packaging: Electron Builder may rebuild/package native dependencies for Electron. The follow-up `npm rebuild better-sqlite3` restores the repo's `node_modules` copy for normal Node/browser-mode development.

Do not delete `visionary.sqlite` to fix native module errors. That resets local dashboard state and does not repair the compiled addon.

## Unsigned packaging

Use unsigned/ad-hoc packaging until Apple signing identities are cleaned up.

Directory-only app build:

```bash
npm run build:unsigned
```

Expected artifact:

```text
dist/mac-arm64/Visionary.app
```

DMG build:

```bash
npm run dist:unsigned
```

Expected artifacts include a `.dmg` under `dist/` plus the unpacked app directory.

The unsigned scripts deliberately disable normal signing identity discovery:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --mac --dir
CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --mac dmg
```

This avoids local release candidates being blocked by duplicate, expired, or ambiguous Apple Development identities.

Unsigned app expectations:

- Good for local release QA.
- Good for handoff to trusted local machines if Gatekeeper quarantine is handled manually.
- Not notarized.
- Not suitable as a public macOS release artifact.

If macOS blocks opening the unsigned app, prefer launching from Terminal for QA:

```bash
dist/mac-arm64/Visionary.app/Contents/MacOS/Visionary
```

If needed for a local trusted artifact, remove quarantine:

```bash
xattr -dr com.apple.quarantine dist/mac-arm64/Visionary.app
open dist/mac-arm64/Visionary.app
```

Only run `xattr -dr` on artifacts you built yourself or otherwise trust.

## Signing issues

Normal signed packaging commands:

```bash
npm run build
npm run dist
```

Known issue: normal signed `npm run build` / `npm run dist` can fail when macOS sees duplicate or ambiguous Apple Development identities. For local release candidates, use `npm run build:unsigned` or `npm run dist:unsigned`.

Inspect signing identities:

```bash
security find-identity -v -p codesigning
```

Common signing failure patterns:

- `Apple Development` identity ambiguity.
- expired or revoked certificate still present in a keychain;
- multiple matching Team IDs;
- missing Developer ID Application identity for distribution;
- hardened runtime/notarization requirements not configured.

Local workaround:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:unsigned
```

Actual public distribution requires a separate signing/notarization pass with a clean Developer ID Application certificate, hardened runtime settings, entitlements if needed, and Apple notarization credentials. Do not treat unsigned DMGs as public releases.

## Manual browser QA checklist

Start or restart the server:

```bash
VISIONARY_PORT=3333 node server.js
```

Open:

```text
http://127.0.0.1:3333/#/overview
```

Check UI routes:

- Overview loads with no browser console errors.
- Board renders and tasks can move between states.
- Agents renders all configured agents.
- Activity renders recent events.
- Inbox renders notifications.
- Crons renders orchestrator scheduling state.
- Briefs renders workspace briefs if present.
- Audits renders workspace audits if present.
- Portfolio renders portfolio data/state.
- Memory renders memory/project context.
- Projects renders project list and detail state.

Check API endpoints:

```bash
curl -s http://127.0.0.1:3333/api/overview | python3 -m json.tool >/dev/null
curl -s http://127.0.0.1:3333/api/orchestrator | python3 -m json.tool >/dev/null
curl -s http://127.0.0.1:3333/api/agents | python3 -m json.tool >/dev/null
curl -s http://127.0.0.1:3333/api/tasks | python3 -m json.tool >/dev/null
curl -s http://127.0.0.1:3333/api/projects | python3 -m json.tool >/dev/null
```

Expected:

- all commands exit 0;
- `/api/overview` returns dashboard JSON;
- `/api/orchestrator` returns gateway/cron health;
- `/api/agents` returns the configured agent allowlist;
- `/api/tasks` and `/api/projects` return arrays or structured JSON, not HTML error pages.

## Manual Electron QA checklist

Development shell:

```bash
npm run app
```

Unsigned packaged app:

```bash
npm run build:unsigned
open dist/mac-arm64/Visionary.app
```

Check:

- native window opens;
- Overview appears without a blank screen;
- closing the Electron app kills the child server process;
- relaunching the app starts the server again;
- browser-mode server is not already occupying port `3333` before launching Electron;
- `dist/mac-arm64/Visionary.app/Contents/MacOS/Visionary` prints useful logs when launched from Terminal.

Port conflict check:

```bash
lsof -nP -iTCP:3333 -sTCP:LISTEN
```

If something is listening on `3333`, stop it before Electron QA unless it is the Visionary server instance you intend to use.

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

Runtime health endpoint when the server is running:

```bash
curl -s http://127.0.0.1:3333/api/orchestrator | python3 -m json.tool
```

## Troubleshooting

### Server will not start

Symptoms:

- `EADDRINUSE`;
- browser cannot connect to `127.0.0.1:3333`;
- Electron opens blank because the server never became reachable.

Fix:

```bash
lsof -nP -iTCP:3333 -sTCP:LISTEN
kill <pid>
VISIONARY_PORT=3333 node server.js
```

Use a different port only for browser mode:

```bash
VISIONARY_PORT=3399 node server.js
open http://127.0.0.1:3399/#/overview
```

Remember: Electron currently expects `3333`.

### SQLite/native addon load error

Symptoms:

- `Cannot find module ... better_sqlite3.node`;
- `ERR_DLOPEN_FAILED`;
- ABI or architecture mismatch;
- app works in Electron but browser-mode Node fails, or the reverse.

Fix:

```bash
npm run rebuild:node
npm run verify
```

If it persists:

```bash
rm -rf node_modules
npm ci
npm run rebuild:node
npm run verify
```

### Database appears locked

Symptoms:

- SQLite busy/locked errors;
- multiple release QA servers running;
- Electron and browser mode both pointed at `./visionary.sqlite`.

Fix:

```bash
lsof visionary.sqlite visionary.sqlite-wal visionary.sqlite-shm
```

Stop duplicate Node/Electron processes. For destructive testing, use a temporary DB instead of the real local state:

```bash
VISIONARY_DB=/tmp/visionary-release-smoke.sqlite VISIONARY_PORT=3333 node server.js
```

### Electron app launches blank

Check server reachability:

```bash
curl -s http://127.0.0.1:3333/api/overview | python3 -m json.tool >/dev/null
```

Launch with logs:

```bash
dist/mac-arm64/Visionary.app/Contents/MacOS/Visionary
```

Common causes:

- port `3333` already occupied;
- packaged app cannot find the intended Node binary;
- `better-sqlite3` native addon mismatch;
- server crashed before Electron loaded the URL.

Try:

```bash
VISIONARY_NODE=/opt/homebrew/bin/node npm run app
npm run rebuild:node
npm run verify
```

### Build fails during signing

Use unsigned mode for local RCs:

```bash
npm run build:unsigned
```

Then inspect identities for the eventual signing cleanup:

```bash
security find-identity -v -p codesigning
```

### Build succeeds but browser mode breaks afterward

Electron packaging may have rebuilt native dependencies. Restore the local Node native addon:

```bash
npm run rebuild:node
npm run verify
```

### OpenClaw/Hermes warnings

Known non-blocking warnings:

- OpenCode and Cursor harnesses may show unavailable until credentials/models are configured.
- OpenClaw doctor may warn about optional memory embedding providers.

Blocking condition:

```bash
openclaw agent --local --agent main --message 'health check: reply with OK only' --json --timeout 60
```

If that command cannot run at all, agent dispatch from Visionary is not release-ready.

## Rollback

If a change breaks the dashboard:

```bash
git diff --stat
npm run verify
```

Then revert only the failing files or restore from the last clean commit. Avoid deleting `visionary.sqlite` unless intentionally resetting local dashboard state.

If the app state itself is suspect, preserve the current DB before any reset:

```bash
cp visionary.sqlite visionary.sqlite.backup.$(date +%Y%m%d-%H%M%S)
```
