# Working Core — Design / Build Spec

**Date:** 2026-06-10
**Status:** Approved (operator chose: ship Node, full working core, all installed harnesses)
**Goal (verbatim):** "figure out the purpose of this dashboard and build it out into its final human usable form with all agents and agent harnesses working"

## Decisions locked

1. **Backend:** Ship the Node backend (`server.js`, :3333). Freeze the Python/FastAPI port (`src/visionary`) as documented future work — do not delete, do not extend.
2. **Scope:** Full working core — make the dispatch→harness→stream critical path real, end to end.
3. **Harnesses:** Wire every installed CLI for real (openclaw, claude, codex, gemini, ollama, cursor, hermes) with real healthchecks and real failover. All are installed on this machine.

## Definition of done

A human can: launch one command → see the live org chart → click **Dispatch** on an agent → a real CLI harness runs (authenticated, permissioned) → output **streams back live** in the drawer → the chain **fails over** on rate-limit/quota exhaustion → the run is **persisted** → and the org/agents views show **honest** health.

## The critical path today (≈70%)

open ✅ → see agents ✅ → dispatch ✅ → harness runs ⚠️ (single runtime, claude perms drop) → stream ❌ (buffered execFile) → failover ❌ (UI path bypasses engine) → persist ✅ (tokens NULL).

## Architecture changes

### A. Launch is deterministic (blocking)
- `scripts/ensure-native.js`: try-require `better-sqlite3`; on `ERR_DLOPEN_FAILED` run `npm rebuild better-sqlite3`. Wire as `prestart`/`predev`/`presmoke` so `npm start` and `npm run verify` self-heal from a clean checkout. (Root cause: committed `.node` binary targets the Electron 32 ABI, not plain node v22's NODE_MODULE_VERSION 127.)
- Boot banner: log resolved port, workspace, and per-harness availability.
- Delete the dead `macos-app/` Swift shell (hardcoded wrong paths; superseded by electron-builder `dist/`).

### B. Dispatch → harness → stream (the crown jewel)
- `src/runtimes/failover.js`: add a streaming attempt path (`spawn`) alongside the buffered one. New `options.onChunk(harness, chunk, stream)`, `options.onChild(child)`, `options.onHarnessStart(harness, idx, total)`. Buffered behavior stays the default when no `onChunk` is given (keeps `executeWithFailover` callers and tests intact).
- `server.js` `dispatchAgent`: route through `executeWithFailover` against the agent's `harness_chain` (from the `agents` table). Stream stdout/stderr over SSE as `agent:output`; announce harness switches as `agent:harness`. Keep all existing lifecycle logic (run rows, notifications, task transitions, reviewer trigger, cost parse). Kill switch works via `onChild` → `activeDispatches`.
- `claude` permission fix: the UI path must forward `allowed_tools` / `max_turns` / `dangerously_skip_permissions`; default trusted-local dispatch uses a write/bash-capable tool set so live runs stop failing on "needs permission".
- `sse.js`: register `agent:output` and `agent:harness` event types.

### C. Real healthchecks + one registry
- Every adapter `healthcheck()` runs `<bin> --version` (or equivalent) with a 3s timeout and returns real `{ok, version}` / `{ok:false, error}`. No more fake `{ok:true}`. `listRuntimes()` becomes async.
- `/api/agents` includes the directors (currently only the flat 13). Reconcile the duplicate `main`/`jarvis`/`hermes` rows so `agents` matches `org-chart.json`. Single source for an agent's harness chain (the table).

### D. Frontend
- The dispatch result drawer (`public/app.js`) subscribes to `agent:output` / `agent:harness` and appends live. Bump `CACHE_NAME` in `public/sw.js`.

### E. Docs + tests
- Fix stale `.planning/ROADMAP.md` + `.planning/STATE.md` to reflect reality (v2.x, phases 2–5 shipped).
- Keep `npm run verify` green; extend smoke coverage for streaming dispatch + real healthchecks.
- Update `README.md` quick-start to a single accurate launch path.

## Out of scope (deferred, documented)
Python migration phases 1c/3/4; token/cost capture wiring; light-theme; mobile nav; reviewer-loop deep fix; WAL retention/rollup; MCP (`src/mcp.js`) stays a stub; document ingestion; Python CI.

## Risk controls
- One git branch (`feat/working-core`), atomic commits per step, `npm run verify` green after each.
- The live server keeps running on the old binary; changes are validated by spawning fresh server instances on temp ports (as the smoke harness already does).
- Buffered failover path stays the default so existing `executeWithFailover` callers (research, scheduler, `/api/agents/:id/dispatch`) and their tests are unaffected.
