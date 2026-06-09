# Python Backend Migration — Phase 1a: Read-only routes + SSE

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the read-only HTTP surface of the Python backend on port 3344 — enough that the existing UI (`public/app.js`) can fetch the org chart, agent list, settings, schedules, and subscribe to the SSE stream. Dispatch + write paths are deferred to Phase 1b.

**Architecture:** FastAPI routes under `src/visionary/routes/`, pydantic v2 response models under `src/visionary/models/`, prepared statements under `src/visionary/db/statements.py`, SSE bus under `src/visionary/sse/bus.py`. All routes are read-only (GET) in this slice. The SSE endpoint streams events from an in-process bus that Phase 2+ will wire into the comm fabric. The frontend stays unchanged.

**Tech Stack:** Python 3.13, FastAPI ≥0.115, pydantic v2, sse-starlette ≥2.1, sqlite3 (stdlib), pytest. No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-06-09-python-backend-design.md` §4 (project layout), §5 (comm fabric — only the SSE bus piece is in scope), §7 Phase 1.

**Prior Phase 0 contracts in use:**
- `Database` (sqlite3 + WAL + savepoints) — `src/visionary/db/database.py`
- `run_migrations` (schema at version 7) — `src/visionary/db/migrations.py`
- `Settings` (env-driven config) — `src/visionary/settings.py`
- `lifespan` in `lifecycle.py` opens DB and stashes on `app.state`

---

## File structure (Phase 1a)

**Files created:**
- `src/visionary/db/statements.py` — prepared statement registry
- `src/visionary/sse/__init__.py`
- `src/visionary/sse/bus.py` — event bus + client registry
- `src/visionary/models/__init__.py`
- `src/visionary/models/common.py` — shared base + helpers
- `src/visionary/models/agent.py`
- `src/visionary/models/org.py`
- `src/visionary/models/settings.py`
- `src/visionary/models/schedule.py`
- `src/visionary/routes/__init__.py`
- `src/visionary/routes/org.py` — `GET /api/org`
- `src/visionary/routes/agents.py` — `GET /api/agents` + `GET /api/agents/{id}`
- `src/visionary/routes/settings.py` — `GET /api/settings/watchdog` (read-only subset)
- `src/visionary/routes/schedules.py` — `GET /api/schedules`
- `src/visionary/routes/events.py` — `GET /api/events` SSE
- `tests/test_statements.py`
- `tests/test_sse.py`
- `tests/test_routes_org.py`
- `tests/test_routes_agents.py`
- `tests/test_routes_settings.py`
- `tests/test_routes_schedules.py`
- `tests/test_routes_events.py`

**Files modified:**
- `src/visionary/main.py` — register routers; SSE bus mount
- `src/visionary/lifecycle.py` — construct SSE bus on startup, stash on `app.state`

Phase 1a does NOT touch:
- Node files
- `bridge.py` / `watchdog.py`
- `public/`, `personalities/`
- `visionary.sqlite` (tests use temp DBs only)
- Any future module (`comm/`, `runtimes/`, `orchestration/`)

---

## Setup

Before Task 1, ensure on `main` with Phase 0 landed:

```bash
cd /Users/joshuasack/Projects/visionary
git fetch origin
git checkout main
git pull --ff-only
git log --oneline -2  # should show 2c04d1c at HEAD
git checkout -b feat/py-phase-1a-read-only-routes
```

All Python commands assume the venv: `.venv/bin/pytest`, `.venv/bin/ruff`, `.venv/bin/uvicorn`.

The live Node backend is on port 3333. The Python backend runs on 3344 — do not bind 3333.

---

### Task 1: Prepared statements registry

**Files:**
- Create: `src/visionary/db/statements.py`
- Create: `tests/test_statements.py`

The pattern mirrors Node's `db.js` where statements are compiled once and reused. In Python's `sqlite3`, statements aren't compiled separately, but we still keep all SQL in one file per the project invariant.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_statements.py
from pathlib import Path

from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.db.statements import Statements


def setup_db(tmp_path: Path) -> Database:
    db = Database(str(tmp_path / "test.sqlite"))
    run_migrations(db)
    return db


def test_get_agent_by_id_returns_dict(tmp_path: Path):
    db = setup_db(tmp_path)
    stmts = Statements(db)
    db.execute(
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, "
        "health_status, expected_activity_within_seconds) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["scout", "Scout", "researcher", "openclaw,claude", "openclaw", "ok", 3600],
    )
    row = stmts.get_agent_by_id("scout")
    assert row is not None
    assert row["id"] == "scout"
    assert row["name"] == "Scout"
    assert stmts.get_agent_by_id("missing") is None
    db.close()


def test_list_agents_returns_all(tmp_path: Path):
    db = setup_db(tmp_path)
    stmts = Statements(db)
    db.execute(
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, health_status, expected_activity_within_seconds) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["a", "A", "r", "openclaw", "openclaw", "ok", 3600],
    )
    db.execute(
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, health_status, expected_activity_within_seconds) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["b", "B", "r", "openclaw", "openclaw", "ok", 3600],
    )
    rows = stmts.list_agents()
    assert {r["id"] for r in rows} == {"a", "b"}
    db.close()


def test_list_schedules_returns_all(tmp_path: Path):
    db = setup_db(tmp_path)
    stmts = Statements(db)
    db.execute(
        "INSERT INTO schedules (id, name, cron, agent_id, prompt, enabled) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        ["s1", "Morning brief", "0 8 * * *", "scout", "research overnight", 1],
    )
    rows = stmts.list_schedules()
    assert len(rows) == 1
    assert rows[0]["name"] == "Morning brief"
    db.close()


def test_get_setting_returns_value_or_none(tmp_path: Path):
    db = setup_db(tmp_path)
    stmts = Statements(db)
    # 'watchdog' settings row was seeded by migration 7
    row = stmts.get_setting("watchdog")
    assert row is not None
    assert "value_json" in row
    assert stmts.get_setting("nope") is None
    db.close()
```

- [ ] **Step 2: Run tests, expect failure**

Run: `.venv/bin/pytest tests/test_statements.py -v`

Expected: 4 failures with `ModuleNotFoundError: No module named 'visionary.db.statements'`.

- [ ] **Step 3: Implement `Statements`**

```python
# src/visionary/db/statements.py
"""Prepared-statement repository.

All SQL the routes use lives here as named methods. This mirrors the Node
side's `db.js` discipline: no inline SQL in route handlers.
"""

from typing import Any

from visionary.db.database import Database


class Statements:
    def __init__(self, db: Database):
        self._db = db

    # --- agents ---
    def get_agent_by_id(self, agent_id: str) -> dict[str, Any] | None:
        return self._db.query_one("SELECT * FROM agents WHERE id = ?", [agent_id])

    def list_agents(self) -> list[dict[str, Any]]:
        return self._db.query("SELECT * FROM agents ORDER BY name")

    # --- schedules ---
    def list_schedules(self) -> list[dict[str, Any]]:
        return self._db.query("SELECT * FROM schedules ORDER BY id")

    # --- settings ---
    def get_setting(self, key: str) -> dict[str, Any] | None:
        return self._db.query_one(
            "SELECT key, value_json FROM settings WHERE key = ?", [key]
        )
```

- [ ] **Step 4: Run tests, verify pass**

Run: `.venv/bin/pytest tests/test_statements.py -v`

Expected: 4/4 PASS.

- [ ] **Step 5: Lint**

Run: `.venv/bin/ruff check src/visionary/db/statements.py tests/test_statements.py`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/visionary/db/statements.py tests/test_statements.py
git commit -m "feat(py): prepared statement registry (Phase 1a)"
```

---

### Task 2: Pydantic response models

**Files:**
- Create: `src/visionary/models/__init__.py`
- Create: `src/visionary/models/common.py`
- Create: `src/visionary/models/agent.py`
- Create: `src/visionary/models/org.py`
- Create: `src/visionary/models/settings.py`
- Create: `src/visionary/models/schedule.py`

These are pydantic v2 models that define the response shapes the existing UI expects. Match what the Node backend currently returns (run `curl http://127.0.0.1:3333/api/...` to confirm shapes if needed).

- [ ] **Step 1: Write the package init**

```python
# src/visionary/models/__init__.py
```

(empty)

- [ ] **Step 2: Write `common.py`**

```python
# src/visionary/models/common.py
from typing import Any

from pydantic import BaseModel, ConfigDict


class VisionaryModel(BaseModel):
    """Base for all pydantic models in the project.

    Permissive on extras at the parsing boundary (we trust DB rows) but strict
    on validation errors at serialization (caller bugs surface immediately).
    """

    model_config = ConfigDict(extra="ignore", frozen=False)


def row_to_dict(row: Any) -> dict[str, Any]:
    """Convert a sqlite3.Row (already dict-coerced by Database.query) to plain dict."""
    if isinstance(row, dict):
        return row
    return dict(row)
```

- [ ] **Step 3: Write `agent.py`**

```python
# src/visionary/models/agent.py
from .common import VisionaryModel


class Agent(VisionaryModel):
    id: str
    name: str
    role: str
    harness_chain: str
    current_harness: str
    health_status: str
    last_activity_at: str | None = None
    last_nudge_at: str | None = None
    expected_activity_within_seconds: int
    personality_path: str | None = None
    watchdog_role: str | None = None


class AgentList(VisionaryModel):
    agents: list[Agent]
```

- [ ] **Step 4: Write `org.py`**

```python
# src/visionary/models/org.py
from typing import Optional

from .agent import Agent
from .common import VisionaryModel


class OrgNode(VisionaryModel):
    """A node in the org chart. Recursive: an agent with optional reports."""

    id: str
    name: str
    role: str
    current_harness: str
    health_status: str
    last_activity_at: str | None = None
    last_nudge_at: str | None = None
    reports: list["OrgNode"] = []


# Forward reference resolution
OrgNode.model_rebuild()


class OrgChart(VisionaryModel):
    ceo: OrgNode
```

- [ ] **Step 5: Write `settings.py`**

```python
# src/visionary/models/settings.py
from .common import VisionaryModel


class WatchdogSettings(VisionaryModel):
    auto_nudge_enabled: bool
    nudge_cooldown_seconds: int


class WatchdogResponse(VisionaryModel):
    watchdog: WatchdogSettings
```

- [ ] **Step 6: Write `schedule.py`**

```python
# src/visionary/models/schedule.py
from .common import VisionaryModel


class Schedule(VisionaryModel):
    id: str
    name: str
    cron: str
    agent_id: str
    prompt: str
    enabled: bool
    last_run_at: str | None = None
    next_run_at: str | None = None


class ScheduleList(VisionaryModel):
    schedules: list[Schedule]
```

- [ ] **Step 7: Quick smoke test (no separate test file needed for models — they'll be tested via route tests)**

Run: `.venv/bin/python -c "from visionary.models.org import OrgChart, OrgNode; print(OrgChart(ceo=OrgNode(id='j', name='Jarvis', role='ceo', current_harness='claude', health_status='ok')).model_dump_json())"`

Expected: prints a JSON object containing `"ceo": {...}` with the Jarvis node.

- [ ] **Step 8: Lint**

Run: `.venv/bin/ruff check src/visionary/models/`

Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/visionary/models/
git commit -m "feat(py): pydantic models for agent/org/settings/schedule (Phase 1a)"
```

---

### Task 3: SSE event bus

**Files:**
- Create: `src/visionary/sse/__init__.py`
- Create: `src/visionary/sse/bus.py`
- Create: `tests/test_sse.py`

The SSE bus is the in-process pub/sub for events streamed to the UI's `EventSource` connection. Phase 2 wires the comm fabric into it; Phase 1a just stands it up.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_sse.py
import asyncio

import pytest

from visionary.sse.bus import EventBus


async def test_event_bus_delivers_to_subscriber():
    bus = EventBus()
    received: list[dict] = []

    async def consume() -> None:
        async for event in bus.subscribe():
            received.append(event)
            if len(received) >= 2:
                return

    consumer = asyncio.create_task(consume())
    # Give consumer a tick to subscribe
    await asyncio.sleep(0)

    await bus.publish({"type": "test", "payload": {"n": 1}})
    await bus.publish({"type": "test", "payload": {"n": 2}})
    await consumer

    assert len(received) == 2
    assert received[0]["payload"]["n"] == 1
    assert received[1]["payload"]["n"] == 2


async def test_event_bus_supports_multiple_subscribers():
    bus = EventBus()
    a: list[dict] = []
    b: list[dict] = []

    async def consume(into: list[dict]) -> None:
        async for event in bus.subscribe():
            into.append(event)
            if len(into) >= 1:
                return

    ca = asyncio.create_task(consume(a))
    cb = asyncio.create_task(consume(b))
    await asyncio.sleep(0)

    await bus.publish({"type": "broadcast", "payload": {"hi": "all"}})
    await ca
    await cb

    assert len(a) == 1
    assert len(b) == 1
    assert a[0]["payload"]["hi"] == "all"
    assert b[0]["payload"]["hi"] == "all"


async def test_event_bus_unsubscribe_drops_client():
    bus = EventBus()
    sub = bus.subscribe()
    # Iterate once to register
    consumer_done = asyncio.Event()

    async def consume_one() -> None:
        async for event in sub:
            consumer_done.set()
            return

    task = asyncio.create_task(consume_one())
    await asyncio.sleep(0)

    await bus.publish({"type": "x", "payload": {}})
    await consumer_done.wait()
    await task

    # After consumer drains, internal client count returns to 0
    assert bus.subscriber_count() == 0
```

Mark these tests `pytest.mark.asyncio` if needed — but since `asyncio_mode = "auto"` is configured, the `async def` tests should pick up automatically.

- [ ] **Step 2: Run tests, expect failure**

Run: `.venv/bin/pytest tests/test_sse.py -v`

Expected: 3 failures with `ModuleNotFoundError: No module named 'visionary.sse'`.

- [ ] **Step 3: Implement the bus**

```python
# src/visionary/sse/__init__.py
from .bus import EventBus

__all__ = ["EventBus"]
```

```python
# src/visionary/sse/bus.py
"""In-process SSE event bus.

Async pub/sub. Each subscriber gets its own queue. Closed automatically when
the consumer stops iterating.

Phase 1a uses this for `/api/events` (read-only stream). Phase 2 will wire
the comm fabric (mailbox/pubsub/direct/blackboard) into the same bus.
"""

import asyncio
import logging
from typing import AsyncIterator

logger = logging.getLogger("visionary.sse.bus")


class EventBus:
    def __init__(self, max_queue_size: int = 1024) -> None:
        self._subscribers: set[asyncio.Queue[dict]] = set()
        self._max_queue_size = max_queue_size
        self._lock = asyncio.Lock()

    async def subscribe(self) -> AsyncIterator[dict]:
        """Async generator that yields events until the consumer stops."""
        queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=self._max_queue_size)
        async with self._lock:
            self._subscribers.add(queue)
        try:
            while True:
                event = await queue.get()
                yield event
        finally:
            async with self._lock:
                self._subscribers.discard(queue)

    async def publish(self, event: dict) -> None:
        """Fan an event out to every current subscriber. Drops events to full
        queues (slow consumer) and logs the drop."""
        async with self._lock:
            targets = list(self._subscribers)
        for q in targets:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning(
                    "SSE subscriber queue full (%d items); dropping event %s",
                    q.qsize(),
                    event.get("type"),
                )

    def subscriber_count(self) -> int:
        return len(self._subscribers)
```

- [ ] **Step 4: Run tests, verify pass**

Run: `.venv/bin/pytest tests/test_sse.py -v`

Expected: 3/3 PASS.

- [ ] **Step 5: Lint**

Run: `.venv/bin/ruff check src/visionary/sse/ tests/test_sse.py`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/visionary/sse/ tests/test_sse.py
git commit -m "feat(py): SSE EventBus (in-process async pub/sub) — Phase 1a"
```

---

### Task 4: `/api/org` route (org chart)

**Files:**
- Create: `src/visionary/routes/__init__.py`
- Create: `src/visionary/routes/org.py`
- Create: `tests/test_routes_org.py`

The org chart comes from two sources combined: `personalities/org-chart.json` (structural source of truth) and the `agents` table (runtime state — `current_harness`, `health_status`, `last_activity_at`, `last_nudge_at`).

For Phase 1a, the route reads the JSON file + DB rows, merges them, returns the tree. Match the response shape of the existing Node route — call `curl -s http://127.0.0.1:3333/api/org > /tmp/node-org.json` and diff against your output.

- [ ] **Step 1: Inspect the existing Node response**

Run:
```bash
curl -s http://127.0.0.1:3333/api/org > /tmp/node-org.json
python -m json.tool < /tmp/node-org.json | head -40
```

Note the shape: `{ "ceo": { "id": ..., "name": ..., "role": ..., "current_harness": ..., "health_status": ..., "last_activity_at": ..., "last_nudge_at": ..., "reports": [...] } }`. The Python response must match this shape (the frontend depends on it).

- [ ] **Step 2: Write the package init + failing tests**

```python
# src/visionary/routes/__init__.py
```
(empty)

```python
# tests/test_routes_org.py
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.main import create_app


@pytest.fixture
def temp_env(tmp_path: Path, monkeypatch) -> Path:
    db_path = tmp_path / "test.sqlite"
    db = Database(str(db_path))
    run_migrations(db)
    # Seed two agents matching org-chart roles
    db.execute(
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, "
        "health_status, expected_activity_within_seconds) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["jarvis", "Jarvis", "ceo", "claude,openclaw", "claude", "ok", 7200],
    )
    db.execute(
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, "
        "health_status, expected_activity_within_seconds) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["scout", "Scout", "researcher", "openclaw,claude", "openclaw", "ok", 3600],
    )
    db.close()

    # Minimal org-chart.json: CEO -> [Scout]
    org_dir = tmp_path / "personalities"
    org_dir.mkdir()
    (org_dir / "org-chart.json").write_text(json.dumps({
        "ceo": {
            "id": "jarvis",
            "name": "Jarvis",
            "role": "ceo",
            "reports": [
                {"id": "scout", "name": "Scout", "role": "researcher", "reports": []}
            ]
        }
    }))

    monkeypatch.setenv("VISIONARY_DB", str(db_path))
    monkeypatch.setenv("VISIONARY_ORG_CHART", str(org_dir / "org-chart.json"))
    monkeypatch.setenv("VISIONARY_PUBLIC", str(tmp_path / "public"))
    (tmp_path / "public").mkdir()
    (tmp_path / "public" / "index.html").write_text("<html></html>")
    return tmp_path


def test_get_org_returns_tree(temp_env: Path):
    app = create_app()
    with TestClient(app) as client:
        r = client.get("/api/org")
        assert r.status_code == 200
        body = r.json()
        assert "ceo" in body
        assert body["ceo"]["id"] == "jarvis"
        assert body["ceo"]["current_harness"] == "claude"
        assert body["ceo"]["health_status"] == "ok"
        assert len(body["ceo"]["reports"]) == 1
        assert body["ceo"]["reports"][0]["id"] == "scout"
        assert body["ceo"]["reports"][0]["current_harness"] == "openclaw"


def test_get_org_missing_agent_row_keeps_node_with_nulls(temp_env: Path, monkeypatch):
    """If an org-chart entry has no matching DB row, the node still renders
    with nulls for runtime fields (don't 500)."""
    # Add an extra report to the JSON that has no agent row
    chart_path = Path(temp_env / "personalities" / "org-chart.json")
    chart = json.loads(chart_path.read_text())
    chart["ceo"]["reports"].append({"id": "ghost", "name": "Ghost", "role": "spy", "reports": []})
    chart_path.write_text(json.dumps(chart))

    app = create_app()
    with TestClient(app) as client:
        r = client.get("/api/org")
        assert r.status_code == 200
        body = r.json()
        ghost = next(n for n in body["ceo"]["reports"] if n["id"] == "ghost")
        assert ghost["current_harness"] in ("", None)
        assert ghost["health_status"] in ("unknown", None, "")
```

- [ ] **Step 3: Add a `VISIONARY_ORG_CHART` env var to `Settings`**

Edit `src/visionary/settings.py` — add a 5th attribute:

```python
        self.org_chart_path: str = os.environ.get(
            "VISIONARY_ORG_CHART", str(repo_root / "personalities" / "org-chart.json")
        )
```

Update `tests/test_settings.py` accordingly (the default test should also assert `s.org_chart_path.endswith("org-chart.json")`).

- [ ] **Step 4: Run tests, expect failure**

Run: `.venv/bin/pytest tests/test_routes_org.py -v`

Expected: 2 failures (404 on /api/org — route doesn't exist yet).

- [ ] **Step 5: Implement `routes/org.py`**

```python
# src/visionary/routes/org.py
"""GET /api/org — read org chart from JSON + DB runtime state."""

import json
from typing import Any

from fastapi import APIRouter, Request

from visionary.db.statements import Statements

router = APIRouter()


def _merge(node: dict[str, Any], by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Combine an org-chart.json node with its runtime row, recursing into reports."""
    row = by_id.get(node["id"], {})
    merged = {
        "id": node["id"],
        "name": node.get("name") or row.get("name") or node["id"],
        "role": node.get("role") or row.get("role") or "",
        "current_harness": row.get("current_harness") or "",
        "health_status": row.get("health_status") or "unknown",
        "last_activity_at": row.get("last_activity_at"),
        "last_nudge_at": row.get("last_nudge_at"),
        "reports": [_merge(r, by_id) for r in node.get("reports", [])],
    }
    return merged


@router.get("/api/org")
async def get_org(request: Request) -> dict:
    settings = request.app.state.settings
    db = request.app.state.db
    stmts = Statements(db)
    rows = stmts.list_agents()
    by_id = {r["id"]: r for r in rows}

    with open(settings.org_chart_path, "r") as f:
        chart = json.load(f)

    return {"ceo": _merge(chart["ceo"], by_id)}
```

- [ ] **Step 6: Register the router in `main.py`**

Edit `src/visionary/main.py`. After the `/healthz` definition and BEFORE the `StaticFiles` mount, add:

```python
    from visionary.routes import org as org_routes

    app.include_router(org_routes.router)
```

(Imports inside `create_app` keep the wiring local and avoid import-time side effects.)

- [ ] **Step 7: Run all relevant tests**

```bash
.venv/bin/pytest tests/test_routes_org.py tests/test_settings.py -v
```

Expected: all PASS.

Run full suite: `.venv/bin/pytest -v` — should be **24 tests total** (Phase 0's 19 + 4 statements + ... wait, count again: Phase 0=19, +4 statements, +3 SSE, +2 org = 28). Adjust to whatever actual count is — just confirm all PASS.

- [ ] **Step 8: Lint**

Run: `.venv/bin/ruff check src/visionary/ tests/`

Expected: clean.

- [ ] **Step 9: Cross-check against the live Node response**

Run:
```bash
# Start the Python app temporarily
.venv/bin/uvicorn visionary.main:app --port 3344 > /tmp/visionary-py-test.log 2>&1 &
PID=$!
sleep 2
diff <(curl -s http://127.0.0.1:3333/api/org | python -m json.tool) \
     <(curl -s http://127.0.0.1:3344/api/org | python -m json.tool) | head -20 || true
kill $PID
```

Note: an exact diff may differ (key ordering, formatting) — focus on whether the SHAPE matches and the same agents appear. Acceptable: minor key-order diffs. Unacceptable: missing keys, missing agents, wrong nesting.

- [ ] **Step 10: Commit**

```bash
git add src/visionary/routes/__init__.py src/visionary/routes/org.py src/visionary/settings.py src/visionary/main.py tests/test_routes_org.py tests/test_settings.py
git commit -m "feat(py): /api/org route (org chart JSON + agent runtime state) — Phase 1a"
```

---

### Task 5: `/api/agents` + `/api/agents/{id}` routes

**Files:**
- Create: `src/visionary/routes/agents.py`
- Create: `tests/test_routes_agents.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_routes_agents.py
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.main import create_app


@pytest.fixture
def temp_env(tmp_path: Path, monkeypatch) -> None:
    db_path = tmp_path / "test.sqlite"
    db = Database(str(db_path))
    run_migrations(db)
    db.execute(
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, "
        "health_status, expected_activity_within_seconds) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["scout", "Scout", "researcher", "openclaw,claude", "openclaw", "ok", 3600],
    )
    db.execute(
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, "
        "health_status, expected_activity_within_seconds) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["broker", "Broker", "analyst", "claude,openclaw", "claude", "ok", 3600],
    )
    db.close()
    monkeypatch.setenv("VISIONARY_DB", str(db_path))
    pub = tmp_path / "public"
    pub.mkdir()
    (pub / "index.html").write_text("<html></html>")
    monkeypatch.setenv("VISIONARY_PUBLIC", str(pub))


def test_list_agents_returns_array(temp_env):
    app = create_app()
    with TestClient(app) as client:
        r = client.get("/api/agents")
        assert r.status_code == 200
        body = r.json()
        assert "agents" in body
        ids = {a["id"] for a in body["agents"]}
        assert ids == {"scout", "broker"}


def test_get_agent_returns_single(temp_env):
    app = create_app()
    with TestClient(app) as client:
        r = client.get("/api/agents/scout")
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == "scout"
        assert body["current_harness"] == "openclaw"


def test_get_agent_not_found_returns_404(temp_env):
    app = create_app()
    with TestClient(app) as client:
        r = client.get("/api/agents/ghost")
        assert r.status_code == 404
```

- [ ] **Step 2: Run tests, expect failure**

Run: `.venv/bin/pytest tests/test_routes_agents.py -v`

Expected: 3 failures (404 — routes not registered).

- [ ] **Step 3: Implement `routes/agents.py`**

```python
# src/visionary/routes/agents.py
from fastapi import APIRouter, HTTPException, Request

from visionary.db.statements import Statements

router = APIRouter()


@router.get("/api/agents")
async def list_agents(request: Request) -> dict:
    stmts = Statements(request.app.state.db)
    return {"agents": stmts.list_agents()}


@router.get("/api/agents/{agent_id}")
async def get_agent(agent_id: str, request: Request) -> dict:
    stmts = Statements(request.app.state.db)
    row = stmts.get_agent_by_id(agent_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"agent not found: {agent_id}")
    return row
```

- [ ] **Step 4: Register the router**

Edit `main.py`, add inside `create_app()`:

```python
    from visionary.routes import agents as agents_routes
    app.include_router(agents_routes.router)
```

(Add this NEXT TO the existing `app.include_router(org_routes.router)` line. Both must come before the `StaticFiles` mount.)

- [ ] **Step 5: Run tests + full suite**

Run: `.venv/bin/pytest -v`

Expected: all PASS.

- [ ] **Step 6: Lint**

Run: `.venv/bin/ruff check src/visionary/routes/ tests/`

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/visionary/routes/agents.py src/visionary/main.py tests/test_routes_agents.py
git commit -m "feat(py): /api/agents + /api/agents/{id} routes — Phase 1a"
```

---

### Task 6: `/api/settings/watchdog` GET route

**Files:**
- Create: `src/visionary/routes/settings.py`
- Create: `tests/test_routes_settings.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_routes_settings.py
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.main import create_app


@pytest.fixture
def temp_env(tmp_path: Path, monkeypatch) -> None:
    db = Database(str(tmp_path / "test.sqlite"))
    run_migrations(db)
    db.close()
    monkeypatch.setenv("VISIONARY_DB", str(tmp_path / "test.sqlite"))
    pub = tmp_path / "public"
    pub.mkdir()
    (pub / "index.html").write_text("<html></html>")
    monkeypatch.setenv("VISIONARY_PUBLIC", str(pub))


def test_get_watchdog_settings_returns_defaults(temp_env):
    """Migration 7 seeded {auto_nudge_enabled: false, nudge_cooldown_seconds: 900}."""
    app = create_app()
    with TestClient(app) as client:
        r = client.get("/api/settings/watchdog")
        assert r.status_code == 200
        body = r.json()
        assert body["watchdog"]["auto_nudge_enabled"] is False
        assert body["watchdog"]["nudge_cooldown_seconds"] == 900
```

- [ ] **Step 2: Run tests, expect failure (404).**

- [ ] **Step 3: Implement `routes/settings.py`**

```python
# src/visionary/routes/settings.py
import json

from fastapi import APIRouter, HTTPException, Request

from visionary.db.statements import Statements

router = APIRouter()


@router.get("/api/settings/watchdog")
async def get_watchdog_settings(request: Request) -> dict:
    stmts = Statements(request.app.state.db)
    row = stmts.get_setting("watchdog")
    if row is None:
        raise HTTPException(status_code=404, detail="watchdog settings missing")
    try:
        parsed = json.loads(row["value_json"])
    except (json.JSONDecodeError, KeyError) as e:
        raise HTTPException(status_code=500, detail=f"watchdog settings malformed: {e}")
    return {"watchdog": parsed}
```

- [ ] **Step 4: Register the router** in `main.py`:

```python
    from visionary.routes import settings as settings_routes
    app.include_router(settings_routes.router)
```

- [ ] **Step 5: Run tests + full suite + lint** — all PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/visionary/routes/settings.py src/visionary/main.py tests/test_routes_settings.py
git commit -m "feat(py): /api/settings/watchdog route — Phase 1a"
```

---

### Task 7: `/api/schedules` GET route

**Files:**
- Create: `src/visionary/routes/schedules.py`
- Create: `tests/test_routes_schedules.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_routes_schedules.py
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.main import create_app


@pytest.fixture
def temp_env(tmp_path: Path, monkeypatch) -> None:
    db = Database(str(tmp_path / "test.sqlite"))
    run_migrations(db)
    db.execute(
        "INSERT INTO schedules (id, name, cron, agent_id, prompt, enabled) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        ["s1", "Morning brief", "0 8 * * *", "scout", "research overnight", 1],
    )
    db.close()
    monkeypatch.setenv("VISIONARY_DB", str(tmp_path / "test.sqlite"))
    pub = tmp_path / "public"
    pub.mkdir()
    (pub / "index.html").write_text("<html></html>")
    monkeypatch.setenv("VISIONARY_PUBLIC", str(pub))


def test_list_schedules_returns_seeded(temp_env):
    app = create_app()
    with TestClient(app) as client:
        r = client.get("/api/schedules")
        assert r.status_code == 200
        body = r.json()
        assert "schedules" in body
        assert len(body["schedules"]) == 1
        assert body["schedules"][0]["name"] == "Morning brief"
        assert body["schedules"][0]["enabled"] in (1, True)  # sqlite stores bool as int
```

- [ ] **Step 2: Run tests, expect failure (404).**

- [ ] **Step 3: Implement `routes/schedules.py`**

```python
# src/visionary/routes/schedules.py
from fastapi import APIRouter, Request

from visionary.db.statements import Statements

router = APIRouter()


@router.get("/api/schedules")
async def list_schedules(request: Request) -> dict:
    stmts = Statements(request.app.state.db)
    return {"schedules": stmts.list_schedules()}
```

- [ ] **Step 4: Register in `main.py`:**

```python
    from visionary.routes import schedules as schedules_routes
    app.include_router(schedules_routes.router)
```

- [ ] **Step 5: Run tests, full suite, lint — all PASS, clean.**

- [ ] **Step 6: Commit**

```bash
git add src/visionary/routes/schedules.py src/visionary/main.py tests/test_routes_schedules.py
git commit -m "feat(py): /api/schedules route — Phase 1a"
```

---

### Task 8: `/api/events` SSE route

**Files:**
- Create: `src/visionary/routes/events.py`
- Create: `tests/test_routes_events.py`

The SSE route streams events from the in-process `EventBus`. The bus is constructed in lifespan and stashed on `app.state.event_bus`. Phase 1a verifies the plumbing works; actual events come from comm fabric in Phase 2.

- [ ] **Step 1: Update `lifecycle.py` to construct the bus**

Edit `src/visionary/lifecycle.py`. Inside the `try` block, add:

```python
        from visionary.sse import EventBus
        app.state.event_bus = EventBus()
```

(After the existing `app.state.schema_version = version` line.)

- [ ] **Step 2: Write the failing test**

```python
# tests/test_routes_events.py
import asyncio
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.main import create_app


@pytest.fixture
def temp_env(tmp_path: Path, monkeypatch) -> None:
    db = Database(str(tmp_path / "test.sqlite"))
    run_migrations(db)
    db.close()
    monkeypatch.setenv("VISIONARY_DB", str(tmp_path / "test.sqlite"))
    pub = tmp_path / "public"
    pub.mkdir()
    (pub / "index.html").write_text("<html></html>")
    monkeypatch.setenv("VISIONARY_PUBLIC", str(pub))


def test_events_endpoint_streams(temp_env):
    """Subscribe to /api/events, publish one event from the bus, expect to read it."""
    app = create_app()
    with TestClient(app) as client:
        # We need to publish AFTER the SSE connection opens. Use a thread or
        # rely on the connect path. Simplest: open a streaming GET, then publish
        # via app.state.event_bus, then read.
        with client.stream("GET", "/api/events") as stream:
            # Schedule a publish on the test client's loop
            bus = app.state.event_bus
            asyncio.run(bus.publish({"type": "ping", "payload": {"hi": True}}))

            # Read at most a few lines to find our event
            seen = ""
            for chunk in stream.iter_lines():
                seen += chunk + "\n"
                if "ping" in seen:
                    break
            assert "ping" in seen
            assert "hi" in seen
```

- [ ] **Step 3: Run tests, expect failure**

Expected: 404 (route not registered) OR test framework error since SSE is tricky to test.

- [ ] **Step 4: Implement `routes/events.py`**

```python
# src/visionary/routes/events.py
"""GET /api/events — SSE stream of in-process events.

The frontend (`public/app.js`) connects via `new EventSource('/api/events')`.
Events come from `app.state.event_bus` (an `EventBus` instance set up in lifespan).
"""

import json
import logging

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

logger = logging.getLogger("visionary.routes.events")
router = APIRouter()


@router.get("/api/events")
async def stream_events(request: Request):
    bus = request.app.state.event_bus

    async def gen():
        async for event in bus.subscribe():
            if await request.is_disconnected():
                return
            yield {
                "event": event.get("type", "message"),
                "data": json.dumps(event.get("payload", {})),
            }

    return EventSourceResponse(gen())
```

- [ ] **Step 5: Register the router** in `main.py`:

```python
    from visionary.routes import events as events_routes
    app.include_router(events_routes.router)
```

- [ ] **Step 6: Run targeted SSE test**

Run: `.venv/bin/pytest tests/test_routes_events.py -v`

SSE testing in `TestClient` can be tricky. If the test hangs, the issue is likely in the streaming flow — make sure `bus.publish` is awaited inside an event loop. If the test passes in <2s, great.

If the test consistently flakes, accept it as DONE_WITH_CONCERNS and note that integration testing of SSE will need a more sophisticated harness (deferred).

- [ ] **Step 7: Full suite + lint**

Run: `.venv/bin/pytest -v` — all pass.
Run: `.venv/bin/ruff check src/visionary/ tests/` — clean.

- [ ] **Step 8: Commit**

```bash
git add src/visionary/routes/events.py src/visionary/lifecycle.py src/visionary/main.py tests/test_routes_events.py
git commit -m "feat(py): /api/events SSE route + EventBus on app.state — Phase 1a"
```

---

### Task 9: Side-by-side sanity check + final verification

Same pattern as Phase 0 Task 6.

- [ ] **Step 1: Confirm Node still alive on 3333** — `curl -s http://127.0.0.1:3333/api/org | head -3`.

- [ ] **Step 2: Start Python on 3344**

```bash
.venv/bin/uvicorn visionary.main:app --host 127.0.0.1 --port 3344 > /tmp/visionary-py-phase1a.log 2>&1 &
UVICORN_PID=$!
sleep 2
```

- [ ] **Step 3: Verify all 5 new routes work**

```bash
echo "--- /api/org ---"
curl -s http://127.0.0.1:3344/api/org | python -m json.tool | head -8
echo "--- /api/agents ---"
curl -s http://127.0.0.1:3344/api/agents | python -m json.tool | head -8
echo "--- /api/agents/coder ---"
curl -s http://127.0.0.1:3344/api/agents/coder | python -m json.tool | head -8
echo "--- /api/settings/watchdog ---"
curl -s http://127.0.0.1:3344/api/settings/watchdog | python -m json.tool
echo "--- /api/schedules ---"
curl -s http://127.0.0.1:3344/api/schedules | python -m json.tool | head -8
```

Expected: all return 200 + JSON bodies. The shapes should match what `/api/...` on the Node side returns.

- [ ] **Step 4: Verify Node side STILL works** — `curl -s http://127.0.0.1:3333/api/org | head -3`.

- [ ] **Step 5: Verify /api/events SSE connects** (open then close cleanly):

```bash
timeout 2 curl -sN http://127.0.0.1:3344/api/events | head -5 || true
```

Expected: connection opens cleanly, may show retry: or keepalive lines. No errors.

- [ ] **Step 6: Stop Python:** `kill $UVICORN_PID && sleep 2`

- [ ] **Step 7: Final test + lint + Node verify**

```bash
.venv/bin/pytest -v 2>&1 | tail -5
.venv/bin/ruff check src/visionary/ tests/
npm run verify 2>&1 | tail -5
```

Expected: all PASS, clean.

- [ ] **Step 8: No commit (manual checkpoint).**

---

### Task 10: Push branch + open PR

- [ ] **Step 1: Push**

```bash
git push -u origin feat/py-phase-1a-read-only-routes
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --base main \
  --title "feat(py): Phase 1a — Read-only routes + SSE bus (Python backend migration)" \
  --body "$(cat <<'EOF'
## Summary

Phase 1a of the Python backend migration. Stands up the read-only HTTP surface on port 3344 so the existing UI can fetch org chart, agents, settings, schedules, and subscribe to the SSE event stream — all served by the new Python backend.

## What this lands

- Prepared statements registry (`db/statements.py`) — all SQL the routes use lives here
- Pydantic v2 response models for agent/org/settings/schedule
- In-process `EventBus` (`sse/bus.py`) — async pub/sub for SSE
- 5 read-only routes:
  - `GET /api/org` — org chart (JSON file + DB runtime state, merged)
  - `GET /api/agents` — list
  - `GET /api/agents/{id}` — single
  - `GET /api/settings/watchdog` — kill switch + cooldown
  - `GET /api/schedules` — list
- `GET /api/events` — SSE stream backed by `EventBus`

## Out of scope (Phase 1b)

- Runtime adapters (claude / openclaw / hermes / cursor / codex / gemini / ollama)
- Dispatch routes (`POST /api/agents/{id}/dispatch`)
- Failover engine
- Rate limiter routes
- Scheduler tick
- Cleanup tick
- Cookbook, guardrails, deep research
- Write routes (POST/PUT/DELETE on settings, schedules, etc.)

## Test plan

- [x] `.venv/bin/pytest -v` — all pass
- [x] `.venv/bin/ruff check` — clean
- [x] `npm run verify` — 22/22 still green (no Node files touched)
- [x] Side-by-side: Python on 3344 served all 5 routes + SSE; Node on 3333 unaffected
EOF
)"
```

- [ ] **Step 3: Note the PR URL.**

---

## Phase 1a acceptance criteria

- [ ] `.venv/bin/pytest -v` — all tests PASS
- [ ] `.venv/bin/ruff check src/visionary/ tests/` — clean
- [ ] `uvicorn visionary.main:app --port 3344` starts cleanly
- [ ] All 5 read-only routes return 200 + correct JSON shape
- [ ] `/api/events` SSE connection opens and streams
- [ ] Node side on 3333 unaffected throughout
- [ ] `npm run verify` — 22/22 still green
- [ ] PR opened against `main`

When Phase 1a lands, Phase 1b (runtime adapters + dispatch + failover) is planned next.
