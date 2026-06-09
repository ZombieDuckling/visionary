# Python Backend Design — Visionary Mission Control

**Date:** 2026-06-09
**Author:** Claude (brainstorming with Josh)
**Status:** Draft for review
**Source goal (verbatim):** "Robust backend with inter-agent communication lanes, watchdogs, health checks, and ability to call and switch agent harnesses"

## 1. Why

The current Node backend works, but the project already runs substantial Python (`bridge.py` for inter-agent messaging, `watchdog.py` for supervision), and the AI-agent ecosystem skews Python. Consolidating to a single language reduces fragmentation, brings typed I/O via pydantic on the API boundary, and lets us absorb the current multi-process topology (Node server + bridge.py + watchdog.py) into one supervised lifecycle. "Robust" is concrete: typed boundaries, single log file, single restart sequence, in-process supervision of comm + watchdog tasks, and a real comm fabric instead of ad-hoc message passing.

The work that just landed on `main` — rate limiter (#14), token-aware replay (#19), dispatch drawer (#17), watchdog auto-nudge (#18) — is preserved by port, not discarded.

## 2. Invariants

Carried forward from `HANDOFF.md`:

- **Single-user, local-first.** Binds 127.0.0.1.
- **SSE for the UI's update channel** (`/api/events`). WebSocket only for agent-to-agent comm.
- **Same `visionary.sqlite` file.** Migrations remain append-only.
- **Frontend stays vanilla** — no build step, no framework, embedded `<script>`.

New invariants:

- **Single Python process** owns the lifecycle (HTTP, SSE, WS, scheduler, watchdog, cleanup).
- **All comm-fabric ops write to `activity_log`** with a `trace_id`.
- **DB layer is stdlib `sqlite3`** with prepared statements — no ORM. Same minimal-deps spirit as the Node side.
- **Direct runtime deps capped at ~5.** Transitive expected ~12.

## 3. Architecture overview

Single `uvicorn` process running a FastAPI app on port 3333. Replaces `server.js` entirely. Absorbs `bridge.py` and `watchdog.py` as in-process asyncio tasks managed by FastAPI's `lifespan` context manager. Ports collapse from {3333, 3334, 3335} → **3333 only**.

**Runtime deps:**

- `fastapi`
- `uvicorn[standard]`
- `pydantic` (v2)
- `sse-starlette` (robust SSE helper)
- `websockets` (already used by bridge.py — reuse)

**Dev deps:** `pytest`, `pytest-asyncio`, `httpx`, `ruff`.

**Frontend:** `public/*` served unchanged via FastAPI's `StaticFiles` mount. Zero frontend changes for the backend swap.

## 4. Project layout

```
visionary/
├── pyproject.toml             # deps, ruff, pytest config
├── src/visionary/
│   ├── main.py                # FastAPI app + lifespan (replaces server.js entry)
│   ├── settings.py            # config (env vars, paths)
│   ├── db/
│   │   ├── database.py        # connection wrapper, thread executor
│   │   ├── migrations.py      # migration runner (port of db.js migrations array)
│   │   └── statements.py      # prepared statement repository
│   ├── routes/                # thin HTTP/SSE/WS handlers — pydantic on the boundary
│   │   ├── agents.py          # dispatch, throttle, messages, health-check
│   │   ├── org.py
│   │   ├── schedules.py
│   │   ├── settings.py
│   │   ├── events.py          # /api/events SSE
│   │   ├── projects.py
│   │   ├── tasks.py
│   │   └── ws.py              # /ws/agent WebSocket (replaces bridge.py port 3334)
│   ├── comm/                  # ← marquee feature
│   │   ├── mailbox.py         # persistent inbox queues
│   │   ├── pubsub.py          # topic pub/sub (port of bridge.py PubSub)
│   │   ├── direct.py          # synchronous agent → agent calls
│   │   ├── blackboard.py      # shared key-value with subscribe-on-change
│   │   └── facade.py          # unified `comm` namespace
│   ├── runtimes/              # harness adapters (port of src/runtimes/*.js)
│   │   ├── failover.py        # execute_with_failover port (incl. rate limit + token-aware replay)
│   │   ├── claude.py, openclaw.py, hermes.py, cursor.py, codex.py, gemini.py, ollama.py
│   ├── orchestration/
│   │   ├── scheduler.py       # cron tick (port of src/scheduler.js)
│   │   ├── watchdog.py        # absorbs watchdog.py
│   │   ├── cleanup.py         # port of src/cleanup.js
│   │   ├── rate_limiter.py    # port of src/rate-limiter.js
│   │   ├── guardrails.py      # port of src/guardrails.js
│   │   ├── cookbook.py        # port of src/cookbook.js
│   │   └── deep_research.py   # port of src/deep-research.js
│   ├── sse/bus.py             # event bus + client registry (port of sse.js)
│   └── lifecycle.py           # startup/shutdown orchestration
├── public/                    # unchanged
├── personalities/             # unchanged
├── tests/
│   ├── test_smoke.py          # port of tests/smoke.mjs
│   ├── test_failover.py
│   ├── test_comm.py
│   └── ...
└── visionary.sqlite           # unchanged
```

At the end of the migration, these Node/legacy files are deleted: `server.js`, `db.js`, `sse.js`, `src/runtimes/*.js`, `src/cookbook.js`, `src/guardrails.js`, `src/scheduler.js`, `src/cleanup.js`, `src/rate-limiter.js`, `src/deep-research.js`, `src/mcp.js`, `bridge.py`, `watchdog.py`, `tests/smoke.mjs`, `package.json`, `package-lock.json`, `node_modules/`.

## 5. The comm fabric (marquee feature)

Four lanes under a unified facade:

```python
from visionary.comm import comm

# Lane 1: persistent inbox queue
mid = await comm.mail(to="broker", sender="ceo", subject="dispatch", body={...}, priority=1)

# Lane 2: topic pub/sub
sub = await comm.subscribe("agent.status.+", handler)
await comm.publish("agent.status.scout", {"status": "working"}, sender="scout")

# Lane 3: synchronous agent → agent call (full harness chain + rate limit + replay)
result = await comm.call(to="scout", sender="ceo", prompt="research X", timeout=300)

# Lane 4: shared key-value with watch
await comm.bb_set("today.brief.id", 42, by="ceo", expected_version=3)
val = await comm.bb_get("today.brief.id")
```

### 5.1 Mailbox — durable inbox

- Persistent in SQLite. Survives restart.
- Priority levels: 0 (normal), 1 (high), 2 (urgent).
- Threading via `thread_id`; reply chains via `reply_to` (flat — one direct parent per message, not nested trees).
- API: `send`, `list`, `mark_read`, `mark_processed`, `thread`.
- HTTP: `POST /api/agents/{id}/mailbox` (send), `GET /api/agents/{id}/mailbox` (list pending), `POST /api/agents/{id}/mailbox/{mid}/ack` (mark processed).

### 5.2 Pub/sub — topic broadcast

- In-process. Exposed to agents via WebSocket on `/ws/agent`.
- MQTT-style wildcards (`+` single-level, `#` multi-level).
- Port `bridge.py`'s `PubSub` class verbatim — semantics preserved.
- WS protocol carried over from bridge.py: `subscribe`, `unsubscribe`, `publish`, `presence`, `ping`/`pong`, `history`. Existing agents keep working without code changes.
- Storage: in-memory by default. Optional write-through to `comm_events` table — deferred (see §8 YAGNI).

### 5.3 Direct call — synchronous request/response

- Wraps `runtimes.failover.execute_with_failover` so a direct call gets the full harness chain + rate limiter + token-aware replay automatically.
- API: `await comm.call(to, sender, prompt, timeout=300, replay_budget=None)` → `{ok, output, harness_used, duration_ms, trace_id}`.
- HTTP: `POST /api/agents/{from}/call/{to}` — body `{prompt, timeout, replay_budget}`. Streams partial output to the caller via SSE (`event: progress`, `event: complete`, `event: error`).

### 5.4 Blackboard — shared key-value with watch

- API: `bb_set(key, value, by, expected_version=None)`, `bb_get(key)`, `bb_watch(key_pattern, handler)`, `bb_delete(key, by)`.
- Optimistic concurrency via `expected_version`. When supplied, `bb_set` raises `BlackboardConflict` if the actual version differs. Omit to do an unconditional write.
- On every mutation, auto-publish to pubsub topic `bb.<key>` so anyone subscribed reacts. This is how "watch" is implemented under the hood.
- HTTP: `GET /api/blackboard/{key}`, `PUT /api/blackboard/{key}`, `DELETE /api/blackboard/{key}`.

### 5.5 Cross-cutting (applies to all 4 lanes)

- **Envelope:** `{from, to | topic | key, ts, type, payload, trace_id}`.
- **Audit:** every comm op writes one row to `activity_log` with its `trace_id`.
- **Trace propagation:** the `comm` facade auto-stamps a `trace_id` on the first call (or accepts one from the caller) and threads it through subsequent ops in the same async context (via `contextvars`). One chain of mailbox → call → bb_set shows up as one trace.
- **Policy gate:** rate limiter is the only enforced policy in v1. The gate is a wrapping function on the facade, so future policies (permissions, quotas) plug in at one point.

## 6. Data model — migration 8

Single atomic migration. Three changes:

```sql
-- 1. Durable inbox queue
CREATE TABLE agent_mailbox (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  to_agent_id   TEXT NOT NULL,
  from_agent_id TEXT,                                       -- nullable for system-originated
  subject       TEXT NOT NULL,
  body_json     TEXT NOT NULL,
  priority      INTEGER NOT NULL DEFAULT 0,                 -- 0 normal, 1 high, 2 urgent
  status        TEXT NOT NULL DEFAULT 'pending',            -- pending, read, processed, failed
  thread_id     TEXT,
  reply_to      INTEGER REFERENCES agent_mailbox(id),
  trace_id      TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  read_at       TEXT,
  processed_at  TEXT,
  FOREIGN KEY (to_agent_id) REFERENCES agents(id)
);
CREATE INDEX idx_mailbox_to_status ON agent_mailbox(to_agent_id, status);
CREATE INDEX idx_mailbox_thread    ON agent_mailbox(thread_id);
CREATE INDEX idx_mailbox_trace     ON agent_mailbox(trace_id);

-- 2. Shared key-value with optimistic concurrency
CREATE TABLE blackboard (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_by  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  version     INTEGER NOT NULL DEFAULT 1
);

-- 3. Cross-lane trace assembly
ALTER TABLE activity_log ADD COLUMN trace_id TEXT;
CREATE INDEX idx_activity_trace ON activity_log(trace_id);
```

**Indexing rationale:**

- `(to_agent_id, status)` — the hot mailbox query ("pending for agent X")
- `thread_id` — fetch a thread for conversation context
- `trace_id` on both mailbox and activity_log — assemble a cross-lane trace via `SELECT * FROM activity_log WHERE trace_id = ?`
- Blackboard uses `key` as PK — sufficient

Migrations 1-7 port verbatim. The Python migration runner mirrors `db.js`'s append-only array pattern: each entry is `(version, sql)`, applied in order, recorded in `schema_version`.

## 7. Migration strategy — Node → Python

Single-user local-first means **no traffic to drain** — clean swap is fine. But we phase the work so each step is independently shippable:

| Phase | Scope | Outcome |
|-------|-------|---------|
| **0** | Scaffold: `pyproject.toml`, FastAPI app skeleton, db wrapper, migration runner, `StaticFiles` mount, pytest scaffold | App starts, serves `index.html`, runs migrations 1-7 against existing SQLite |
| **1** | Port all 15 routes + 7 runtime adapters + scheduler + cleanup + rate limiter + guardrails + cookbook 1:1. Port `tests/smoke.mjs` to `tests/test_smoke.py` | Functionally equivalent to current Node backend. Run side-by-side on port 3344 and diff responses against 3333 |
| **2** | Comm fabric: migration 8, mailbox/blackboard/direct/pubsub modules, unified `comm` facade, HTTP + WS routes | Comm fabric live |
| **3** | Absorb watchdog + bridge as asyncio lifespan tasks | One process, one log file, one restart sequence |
| **4** | Cutover: kill Node + bridge.py + watchdog.py, start Python on 3333, run gstack qa/browse/design-review to sanity-check UI against the Python backend, delete legacy files | Node retired |

### 7.1 Risk register

- **better-sqlite3 → stdlib sqlite3 concurrency.** WAL mode + single-writer through the db wrapper. Same model as Node side; behavior should match.
- **SSE under uvicorn vs node:http.** `sse-starlette` is battle-tested. Smoke-test reconnect + `Last-Event-ID` flow as part of Phase 1 verification.
- **Existing frontend's expectations on response shapes.** Pydantic response models pinned to current JSON shapes. Smoke tests assert exact structure (port `tests/smoke.mjs` first as the contract).
- **WebSocket protocol compatibility with existing agents.** Same message types as `bridge.py`. Smoke test with a Python WS client at end of Phase 2.
- **Frontend Cmd+R / service worker caching across the cutover.** Bump `CACHE_NAME` once during cutover so PWA refreshes; even though the frontend code didn't change, the cache may have stale API response shapes.

### 7.2 Effort estimate

Focused work, single person:

- Phase 0: ~half day
- Phase 1: ~full day
- Phase 2: ~full day
- Phase 3: ~half day
- Phase 4: ~half day

**~3 days end-to-end.** Each phase ships as its own PR. Phase 1 is the natural fan-out point — 15 routes + 7 runtime adapters can be split across parallel agents.

## 8. What we're NOT building (YAGNI)

- **`comm_events` replay table.** Pub/sub stays in-memory by default. Add later if event replay becomes a need.
- **Standalone `comm_traces` table.** `trace_id` on `activity_log` is sufficient — every comm op writes there.
- **SQLModel / SQLAlchemy.** Raw `sqlite3` + prepared statements matches Node-side discipline.
- **Multi-user auth / RBAC / tenancy.** Single-user, local-first.
- **Uvicorn workers > 1.** Single process is enough for one user.
- **Permissions enforcement on comm operations.** Out of scope for v1. The policy gate is in place; rate limits are the only policy enforced today.
- **MCP server integration (#16).** Still blocked on the `@modelcontextprotocol/sdk` go/no-go decision. Issue stays open; not in scope for this migration.
- **Document ingestion (#15).** Still blocked on the system-binary-vs-pip-dep decision. Issue stays open; not in scope for this migration.

## 9. Open questions (resolve during implementation)

- **Direct-call streaming surface.** Should `comm.call` also emit progress events to pubsub topic `call.progress.<trace_id>`, or only stream over the HTTP SSE response? Decision deferred to Phase 2.
- **Mailbox auto-expiry.** Should processed messages auto-expire after N days? Cleanup tick could enforce. Default: no expiry. Add if storage bloats.
- **Direct-call timeout granularity.** Per-call or per-harness? Default: per-call, harness-agnostic. Per-harness can be added if a single slow adapter dominates.
- **`comm` facade re-entry.** If a handler triggered by `bb_watch` calls `bb_set` on the same key, do we allow it? Default: yes, but the new write generates a new `trace_id` (it's a downstream effect, not a continuation). Worth confirming.
