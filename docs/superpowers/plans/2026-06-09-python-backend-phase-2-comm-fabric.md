# Python Backend Migration — Phase 2: Comm Fabric

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Implement the inter-agent communication fabric in Python — migration 8 (mailbox + blackboard + trace_id), four communication lanes (mailbox / pub-sub / direct / blackboard) with a unified `comm` facade, HTTP routes for mailbox + blackboard, and a WebSocket `/ws/agent` endpoint that supersedes `bridge.py`. **Delivers "inter-agent communication lanes" from the project goal.**

**Architecture:** All comm code under `src/visionary/comm/`. The four lanes share an envelope (`{from, to|topic|key, ts, type, payload, trace_id}`), an `activity_log` audit trail, and a policy gate. `trace_id` propagates via `contextvars`. The WebSocket protocol mirrors `bridge.py`'s (subscribe / unsubscribe / publish / presence / ping / history) so existing agent clients keep working.

**Tech stack:** No new pip deps (`websockets` is already in pyproject; FastAPI handles WS natively too).

**Spec reference:** `docs/superpowers/specs/2026-06-09-python-backend-design.md` §5 (comm fabric), §6 (data model migration 8).

**Prior contracts in use:**
- `Database` + savepoints; `Statements`; `Settings`; `EventBus`; `Registry`; `RateLimiter`
- `execute_with_failover` (used by direct.call)

---

## File structure (Phase 2)

**Files created:**
- `src/visionary/comm/__init__.py`
- `src/visionary/comm/envelope.py` — `Envelope` dataclass + `trace_id` contextvar
- `src/visionary/comm/mailbox.py` — durable inbox
- `src/visionary/comm/pubsub.py` — port `bridge.py`'s PubSub
- `src/visionary/comm/blackboard.py` — shared K/V with watch
- `src/visionary/comm/direct.py` — synchronous agent → agent call (wraps failover)
- `src/visionary/comm/facade.py` — unified `comm` namespace
- `src/visionary/routes/mailbox.py`
- `src/visionary/routes/blackboard.py`
- `src/visionary/routes/ws.py` — `/ws/agent` WebSocket
- `tests/test_envelope.py`
- `tests/test_mailbox.py`
- `tests/test_pubsub.py`
- `tests/test_blackboard.py`
- `tests/test_direct.py`
- `tests/test_facade.py`
- `tests/test_routes_mailbox.py`
- `tests/test_routes_blackboard.py`
- `tests/test_routes_ws.py`

**Files modified:**
- `src/visionary/db/migrations.py` — append migration 8
- `src/visionary/db/statements.py` — mailbox/blackboard statements
- `src/visionary/main.py` — register mailbox + blackboard + ws routers
- `src/visionary/lifecycle.py` — construct PubSub + Mailbox + Blackboard + Facade on `app.state.comm`

**Phase 2 does NOT touch:** Node files, `bridge.py` (it stays running until Phase 3/4), `watchdog.py`, frontend, runtime adapters (other than direct.call wrapping failover).

---

## Setup

Before Task 1, branch off latest main:

```bash
cd /Users/joshuasack/Projects/visionary
git fetch origin
git checkout main
git pull --ff-only
git log --oneline -2  # 7a4df9f at HEAD
git checkout -b feat/py-phase-2-comm-fabric
```

---

### Task 1: Migration 8 — agent_mailbox + blackboard + trace_id

**Files:**
- Modify: `src/visionary/db/migrations.py` — append migration 8 (preserve append-only invariant)
- Create: `tests/test_migration_8.py`

- [ ] **Step 1: Failing tests**

```python
# tests/test_migration_8.py
from pathlib import Path

from visionary.db import Database
from visionary.db.migrations import run_migrations, MIGRATIONS


def test_migration_8_creates_agent_mailbox(tmp_path: Path):
    db = Database(str(tmp_path / "t.sqlite"))
    final = run_migrations(db)
    assert final >= 8
    tables = {r["name"] for r in db.query(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    assert "agent_mailbox" in tables
    cols = {r["name"] for r in db.query("PRAGMA table_info(agent_mailbox)")}
    expected = {
        "id", "to_agent_id", "from_agent_id", "subject", "body_json",
        "priority", "status", "thread_id", "reply_to", "trace_id",
        "created_at", "read_at", "processed_at",
    }
    assert expected.issubset(cols), f"missing: {expected - cols}"
    db.close()


def test_migration_8_creates_blackboard(tmp_path: Path):
    db = Database(str(tmp_path / "t.sqlite"))
    run_migrations(db)
    tables = {r["name"] for r in db.query(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    assert "blackboard" in tables
    cols = {r["name"] for r in db.query("PRAGMA table_info(blackboard)")}
    expected = {"key", "value_json", "updated_by", "updated_at", "version"}
    assert expected.issubset(cols)
    db.close()


def test_migration_8_adds_trace_id_to_activity_log(tmp_path: Path):
    db = Database(str(tmp_path / "t.sqlite"))
    run_migrations(db)
    cols = {r["name"] for r in db.query("PRAGMA table_info(activity_log)")}
    assert "trace_id" in cols
    db.close()


def test_migrations_list_has_8_entries(tmp_path: Path):
    assert len(MIGRATIONS) == 8


def test_migration_8_indexes_exist(tmp_path: Path):
    db = Database(str(tmp_path / "t.sqlite"))
    run_migrations(db)
    idx = {r["name"] for r in db.query(
        "SELECT name FROM sqlite_master WHERE type='index'"
    )}
    assert "idx_mailbox_to_status" in idx
    assert "idx_mailbox_thread" in idx
    assert "idx_mailbox_trace" in idx
    assert "idx_activity_trace" in idx
    db.close()
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Append migration 8 to `MIGRATIONS`**

Open `src/visionary/db/migrations.py`. At the END of the `MIGRATIONS` list (after the migration-7 tuple), add:

```python
    (
        8,
        """
        CREATE TABLE agent_mailbox (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            to_agent_id   TEXT NOT NULL,
            from_agent_id TEXT,
            subject       TEXT NOT NULL,
            body_json     TEXT NOT NULL,
            priority      INTEGER NOT NULL DEFAULT 0,
            status        TEXT NOT NULL DEFAULT 'pending',
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

        CREATE TABLE blackboard (
            key         TEXT PRIMARY KEY,
            value_json  TEXT NOT NULL,
            updated_by  TEXT,
            updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
            version     INTEGER NOT NULL DEFAULT 1
        );

        ALTER TABLE activity_log ADD COLUMN trace_id TEXT;
        CREATE INDEX idx_activity_trace ON activity_log(trace_id);
        """,
    ),
```

- [ ] **Step 4: GREEN — 5/5 PASS.**

- [ ] **Step 5: Full suite + lint** — 76 PASS (71 + 5 new), ruff clean.

- [ ] **Step 6: Commit**

```bash
git add src/visionary/db/migrations.py tests/test_migration_8.py
git commit -m "feat(py): migration 8 — agent_mailbox + blackboard + activity_log.trace_id"
```

---

### Task 2: Envelope + trace_id contextvar

**Files:**
- Create: `src/visionary/comm/__init__.py` (empty for now)
- Create: `src/visionary/comm/envelope.py`
- Create: `tests/test_envelope.py`

- [ ] **Step 1: Failing tests**

```python
# tests/test_envelope.py
from visionary.comm.envelope import (
    Envelope, new_trace_id, current_trace_id, with_trace_id,
)


def test_envelope_round_trip():
    e = Envelope(
        from_="ceo", to="scout", topic=None, key=None,
        type="mail", payload={"subject": "hi"}, trace_id="t-1",
    )
    assert e.from_ == "ceo"
    assert e.to == "scout"
    assert e.trace_id == "t-1"


def test_new_trace_id_returns_unique_strings():
    a = new_trace_id()
    b = new_trace_id()
    assert isinstance(a, str)
    assert a != b


def test_with_trace_id_sets_contextvar_for_block():
    assert current_trace_id() is None
    with with_trace_id("t-x"):
        assert current_trace_id() == "t-x"
    assert current_trace_id() is None


def test_nested_with_trace_id_restores_outer():
    with with_trace_id("t-outer"):
        assert current_trace_id() == "t-outer"
        with with_trace_id("t-inner"):
            assert current_trace_id() == "t-inner"
        assert current_trace_id() == "t-outer"
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement**

```python
# src/visionary/comm/envelope.py
"""Common envelope + trace_id contextvar for the comm fabric.

Every comm op (mailbox.send, pubsub.publish, direct.call, bb_set) carries
a trace_id. Code paths use `with with_trace_id(tid):` to scope a trace.
Inside that block, `current_trace_id()` returns `tid`; outside it returns
the previous value (or None).
"""

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any, Iterator
from uuid import uuid4


@dataclass
class Envelope:
    from_: str | None
    to: str | None
    topic: str | None
    key: str | None
    type: str
    payload: dict[str, Any]
    trace_id: str | None


_trace_id_var: ContextVar[str | None] = ContextVar("visionary_trace_id", default=None)


def new_trace_id() -> str:
    return uuid4().hex


def current_trace_id() -> str | None:
    return _trace_id_var.get()


@contextmanager
def with_trace_id(trace_id: str) -> Iterator[None]:
    token = _trace_id_var.set(trace_id)
    try:
        yield
    finally:
        _trace_id_var.reset(token)
```

```python
# src/visionary/comm/__init__.py
```
(empty for now; facade exports come later)

- [ ] **Step 4: GREEN, suite + lint.**

- [ ] **Step 5: Commit**

```bash
git add src/visionary/comm/__init__.py src/visionary/comm/envelope.py tests/test_envelope.py
git commit -m "feat(py): comm envelope + trace_id contextvar — Phase 2"
```

---

### Task 3: Mailbox (durable inbox queue)

**Files:**
- Create: `src/visionary/comm/mailbox.py`
- Create: `tests/test_mailbox.py`
- Modify: `src/visionary/db/statements.py` — add mailbox statements

- [ ] **Step 1: Extend statements**

Append to `Statements`:

```python
    # --- mailbox ---
    def insert_mailbox_message(
        self, to_agent_id: str, from_agent_id: str | None,
        subject: str, body_json: str, priority: int = 0,
        thread_id: str | None = None, reply_to: int | None = None,
        trace_id: str | None = None,
    ) -> int:
        cursor = self._db.execute(
            "INSERT INTO agent_mailbox "
            "(to_agent_id, from_agent_id, subject, body_json, priority, "
            " thread_id, reply_to, trace_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [to_agent_id, from_agent_id, subject, body_json, priority,
             thread_id, reply_to, trace_id],
        )
        return cursor.lastrowid

    def list_mailbox(
        self, to_agent_id: str, status: str = "pending", limit: int = 50
    ) -> list[dict]:
        return self._db.query(
            "SELECT * FROM agent_mailbox "
            "WHERE to_agent_id = ? AND status = ? "
            "ORDER BY priority DESC, id ASC LIMIT ?",
            [to_agent_id, status, limit],
        )

    def get_mailbox_message(self, mid: int) -> dict | None:
        return self._db.query_one("SELECT * FROM agent_mailbox WHERE id = ?", [mid])

    def mark_mailbox_read(self, mid: int) -> None:
        self._db.execute(
            "UPDATE agent_mailbox SET status = 'read', read_at = datetime('now') "
            "WHERE id = ?",
            [mid],
        )

    def mark_mailbox_processed(self, mid: int) -> None:
        self._db.execute(
            "UPDATE agent_mailbox SET status = 'processed', "
            "processed_at = datetime('now') "
            "WHERE id = ?",
            [mid],
        )

    def list_thread(self, thread_id: str, limit: int = 100) -> list[dict]:
        return self._db.query(
            "SELECT * FROM agent_mailbox WHERE thread_id = ? ORDER BY id ASC LIMIT ?",
            [thread_id, limit],
        )
```

- [ ] **Step 2: Failing tests**

```python
# tests/test_mailbox.py
import json
from pathlib import Path

import pytest

from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.comm.mailbox import Mailbox


@pytest.fixture
def mb(tmp_path: Path):
    db = Database(str(tmp_path / "t.sqlite"))
    run_migrations(db)
    db.execute(
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, "
        "health_status, expected_activity_within_seconds) "
        "VALUES ('scout','Scout','r','claude','claude','ok',3600)"
    )
    db.execute(
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, "
        "health_status, expected_activity_within_seconds) "
        "VALUES ('broker','Broker','a','claude','claude','ok',3600)"
    )
    yield Mailbox(db), db
    db.close()


def test_send_and_list_pending(mb):
    mailbox, db = mb
    mid = mailbox.send(to="scout", sender="broker", subject="task",
                       body={"text": "do X"}, priority=1)
    msgs = mailbox.list(to="scout")
    assert len(msgs) == 1
    assert msgs[0]["id"] == mid
    assert msgs[0]["subject"] == "task"
    assert json.loads(msgs[0]["body_json"]) == {"text": "do X"}
    assert msgs[0]["priority"] == 1


def test_mark_read_moves_status(mb):
    mailbox, db = mb
    mid = mailbox.send(to="scout", sender=None, subject="hi", body={})
    mailbox.mark_read(mid)
    pending = mailbox.list(to="scout", status="pending")
    assert pending == []
    read = mailbox.list(to="scout", status="read")
    assert len(read) == 1


def test_mark_processed_terminal(mb):
    mailbox, db = mb
    mid = mailbox.send(to="scout", sender=None, subject="hi", body={})
    mailbox.mark_processed(mid)
    processed = mailbox.list(to="scout", status="processed")
    assert len(processed) == 1


def test_thread_groups_messages(mb):
    mailbox, db = mb
    a = mailbox.send(to="scout", sender="broker", subject="A", body={}, thread_id="th-1")
    b = mailbox.send(to="scout", sender="broker", subject="B", body={}, thread_id="th-1")
    thread = mailbox.thread("th-1")
    assert {m["id"] for m in thread} == {a, b}


def test_priority_orders_list(mb):
    mailbox, db = mb
    mailbox.send(to="scout", sender=None, subject="low", body={}, priority=0)
    mailbox.send(to="scout", sender=None, subject="high", body={}, priority=2)
    mailbox.send(to="scout", sender=None, subject="med", body={}, priority=1)
    msgs = mailbox.list(to="scout")
    subs = [m["subject"] for m in msgs]
    assert subs == ["high", "med", "low"]
```

- [ ] **Step 3: RED.**

- [ ] **Step 4: Implement Mailbox**

```python
# src/visionary/comm/mailbox.py
"""Durable inbox queue. Each message persists in agent_mailbox."""

import json
from typing import Any

from visionary.comm.envelope import current_trace_id
from visionary.db.database import Database
from visionary.db.statements import Statements


class Mailbox:
    def __init__(self, db: Database):
        self._stmts = Statements(db)

    def send(
        self, to: str, sender: str | None, subject: str,
        body: dict[str, Any], priority: int = 0,
        thread_id: str | None = None, reply_to: int | None = None,
    ) -> int:
        return self._stmts.insert_mailbox_message(
            to_agent_id=to, from_agent_id=sender,
            subject=subject, body_json=json.dumps(body), priority=priority,
            thread_id=thread_id, reply_to=reply_to,
            trace_id=current_trace_id(),
        )

    def list(self, to: str, status: str = "pending", limit: int = 50) -> list[dict]:
        return self._stmts.list_mailbox(to, status, limit)

    def get(self, mid: int) -> dict | None:
        return self._stmts.get_mailbox_message(mid)

    def mark_read(self, mid: int) -> None:
        self._stmts.mark_mailbox_read(mid)

    def mark_processed(self, mid: int) -> None:
        self._stmts.mark_mailbox_processed(mid)

    def thread(self, thread_id: str, limit: int = 100) -> list[dict]:
        return self._stmts.list_thread(thread_id, limit)
```

- [ ] **Step 5: GREEN, suite + lint.**

- [ ] **Step 6: Commit**

```bash
git add src/visionary/comm/mailbox.py src/visionary/db/statements.py tests/test_mailbox.py
git commit -m "feat(py): mailbox (durable inbox queue) — Phase 2"
```

---

### Task 4: Pub/sub (port bridge.py's PubSub)

**Files:**
- Create: `src/visionary/comm/pubsub.py`
- Create: `tests/test_pubsub.py`

This is a faithful port of the in-memory pub/sub from `bridge.py`. MQTT-style wildcards (`+` single-level, `#` multi-level). No persistence (use EventBus for SSE separately).

- [ ] **Step 1: Failing tests**

```python
# tests/test_pubsub.py
import asyncio
import pytest

from visionary.comm.pubsub import PubSub, topic_matches


@pytest.mark.parametrize("sub,topic,expected", [
    ("agent.chat.scout", "agent.chat.scout", True),
    ("agent.chat.+", "agent.chat.scout", True),
    ("agent.chat.+", "agent.chat.scout.deep", False),
    ("agent.chat.#", "agent.chat.scout.deep", True),
    ("agent.#", "agent.chat.scout", True),
    ("#", "anything.here", True),
    ("agent.chat.scout", "agent.chat.broker", False),
])
def test_topic_matches(sub, topic, expected):
    assert topic_matches(sub, topic) is expected


async def test_publish_delivers_to_matching_subscriber():
    ps = PubSub()
    received: list[dict] = []

    async def consume():
        async for msg in ps.subscribe(["agent.chat.+"]):
            received.append(msg)
            if len(received) >= 1:
                return

    task = asyncio.create_task(consume())
    await asyncio.sleep(0)
    await ps.publish("agent.chat.scout", {"text": "hi"}, sender="broker")
    await task
    assert received[0]["topic"] == "agent.chat.scout"
    assert received[0]["payload"] == {"text": "hi"}
    assert received[0]["from"] == "broker"


async def test_publish_does_not_deliver_to_non_match():
    ps = PubSub()
    received: list[dict] = []
    delivered_event = asyncio.Event()

    async def consume():
        async for msg in ps.subscribe(["agent.chat.+"]):
            received.append(msg)
            delivered_event.set()
            return

    task = asyncio.create_task(consume())
    await asyncio.sleep(0)
    # This should NOT match agent.chat.+
    await ps.publish("task.42", {}, sender="x")
    # Then trigger a match so the consumer can exit cleanly
    await ps.publish("agent.chat.scout", {"hit": True}, sender="x")
    await asyncio.wait_for(delivered_event.wait(), timeout=1)
    await task
    assert len(received) == 1
    assert received[0]["topic"] == "agent.chat.scout"


def test_history_returns_published_topics():
    ps = PubSub()
    # No subscribers; publish records into history regardless
    asyncio.get_event_loop_policy()  # avoid lint warning
    import asyncio as _a
    _a.get_event_loop().run_until_complete(
        ps.publish("system", {"heartbeat": True}, sender="system")
    )
    hist = ps.history("system", limit=10)
    assert any("heartbeat" in str(m["payload"]) for m in hist)
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement PubSub**

```python
# src/visionary/comm/pubsub.py
"""Topic pub/sub with MQTT-style wildcards.

Port of bridge.py's PubSub class. In-memory only (Phase 2). Each subscribe()
call returns an async generator that yields matching messages.
"""

import asyncio
from datetime import datetime, timezone
from typing import AsyncIterator

_MAX_HISTORY = 100


def topic_matches(subscription: str, topic: str) -> bool:
    """MQTT wildcards: `+` matches one level, `#` matches rest."""
    if subscription == topic or subscription == "#":
        return True
    sub_parts = subscription.split(".")
    topic_parts = topic.split(".")
    for i, sp in enumerate(sub_parts):
        if sp == "#":
            return True
        if i >= len(topic_parts):
            return False
        if sp == "+":
            continue
        if sp != topic_parts[i]:
            return False
    return len(sub_parts) == len(topic_parts)


class PubSub:
    def __init__(self) -> None:
        self._subscribers: list[tuple[list[str], asyncio.Queue[dict]]] = []
        self._history: dict[str, list[dict]] = {}
        self._lock = asyncio.Lock()

    async def subscribe(self, topics: list[str]) -> AsyncIterator[dict]:
        q: asyncio.Queue[dict] = asyncio.Queue(maxsize=1024)
        async with self._lock:
            self._subscribers.append((list(topics), q))
        try:
            while True:
                msg = await q.get()
                yield msg
        finally:
            async with self._lock:
                self._subscribers = [(s, qq) for (s, qq) in self._subscribers if qq is not q]

    async def publish(self, topic: str, payload: dict, sender: str = "system") -> None:
        msg = {
            "type": "message",
            "topic": topic,
            "payload": payload,
            "from": sender,
            "ts": datetime.now(timezone.utc).isoformat(),
        }
        self._history.setdefault(topic, []).append(msg)
        if len(self._history[topic]) > _MAX_HISTORY:
            self._history[topic] = self._history[topic][-_MAX_HISTORY:]

        async with self._lock:
            targets = [
                (subs, q) for (subs, q) in self._subscribers
                if any(topic_matches(s, topic) for s in subs)
            ]
        for _subs, q in targets:
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                pass

    def history(self, topic_filter: str, limit: int = 20) -> list[dict]:
        results: list[dict] = []
        for t, msgs in self._history.items():
            if topic_matches(topic_filter, t):
                results.extend(msgs)
        results.sort(key=lambda m: m.get("ts", ""), reverse=True)
        return results[:limit]

    def subscriber_count(self) -> int:
        return len(self._subscribers)
```

- [ ] **Step 4: GREEN.**

Note on the `test_history_returns_published_topics` test: it uses `asyncio.run` style. Adjust if it complains about loop state — simpler to make it `async def` and use `await ps.publish(...)`.

- [ ] **Step 5: Suite + lint.**

- [ ] **Step 6: Commit**

```bash
git add src/visionary/comm/pubsub.py tests/test_pubsub.py
git commit -m "feat(py): pubsub (MQTT-style wildcards, ported from bridge.py) — Phase 2"
```

---

### Task 5: Blackboard (shared K/V with optimistic concurrency)

**Files:**
- Create: `src/visionary/comm/blackboard.py`
- Create: `tests/test_blackboard.py`
- Modify: `src/visionary/db/statements.py` — blackboard statements

- [ ] **Step 1: Extend statements**

Append to `Statements`:

```python
    # --- blackboard ---
    def get_blackboard(self, key: str) -> dict | None:
        return self._db.query_one(
            "SELECT * FROM blackboard WHERE key = ?", [key]
        )

    def upsert_blackboard(
        self, key: str, value_json: str, updated_by: str | None,
        expected_version: int | None = None,
    ) -> int:
        """Returns the new version. Raises if expected_version doesn't match."""
        row = self.get_blackboard(key)
        if row is None:
            self._db.execute(
                "INSERT INTO blackboard (key, value_json, updated_by, version) "
                "VALUES (?, ?, ?, 1)",
                [key, value_json, updated_by],
            )
            return 1
        if expected_version is not None and row["version"] != expected_version:
            raise BlackboardConflictError(
                f"version mismatch for key {key}: "
                f"expected {expected_version}, actual {row['version']}"
            )
        new_version = row["version"] + 1
        self._db.execute(
            "UPDATE blackboard SET value_json = ?, updated_by = ?, "
            "version = ?, updated_at = datetime('now') WHERE key = ?",
            [value_json, updated_by, new_version, key],
        )
        return new_version

    def delete_blackboard(self, key: str) -> None:
        self._db.execute("DELETE FROM blackboard WHERE key = ?", [key])


class BlackboardConflictError(Exception):
    pass
```

(`BlackboardConflictError` lives in statements module for ease of import; OR move to blackboard.py — pick one. The spec recommends blackboard.py.)

Actually — **better:** define `BlackboardConflictError` in `comm/blackboard.py` and import it into `statements.py`. This keeps domain errors in the domain module. Adjust as you implement.

- [ ] **Step 2: Failing tests**

```python
# tests/test_blackboard.py
import json
from pathlib import Path

import pytest

from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.comm.blackboard import Blackboard, BlackboardConflictError


@pytest.fixture
def bb(tmp_path: Path):
    db = Database(str(tmp_path / "t.sqlite"))
    run_migrations(db)
    yield Blackboard(db), db
    db.close()


def test_set_then_get(bb):
    blackboard, db = bb
    v = blackboard.set("topic.brief.id", {"id": 42}, by="ceo")
    assert v == 1
    row = blackboard.get("topic.brief.id")
    assert json.loads(row["value_json"]) == {"id": 42}
    assert row["version"] == 1
    assert row["updated_by"] == "ceo"


def test_set_again_increments_version(bb):
    blackboard, db = bb
    blackboard.set("x", {"n": 1}, by="ceo")
    v2 = blackboard.set("x", {"n": 2}, by="ceo")
    assert v2 == 2
    assert blackboard.get("x")["version"] == 2


def test_optimistic_concurrency_conflict(bb):
    blackboard, db = bb
    blackboard.set("y", {"n": 1}, by="ceo")
    # Simulate another writer bumping version
    blackboard.set("y", {"n": 2}, by="someone")
    # Our local "expected" is still 1 → conflict
    with pytest.raises(BlackboardConflictError):
        blackboard.set("y", {"n": 99}, by="ceo", expected_version=1)


def test_delete_removes_row(bb):
    blackboard, db = bb
    blackboard.set("z", {}, by="ceo")
    assert blackboard.get("z") is not None
    blackboard.delete("z")
    assert blackboard.get("z") is None
```

- [ ] **Step 3: RED.**

- [ ] **Step 4: Implement Blackboard**

```python
# src/visionary/comm/blackboard.py
"""Shared key-value with optimistic concurrency.

Each `set` either creates a new row (version=1) or updates with version+1.
If `expected_version` is supplied, mismatch raises BlackboardConflictError.
"""

import json
from typing import Any

from visionary.db.database import Database
from visionary.db.statements import Statements


class BlackboardConflictError(Exception):
    pass


class Blackboard:
    def __init__(self, db: Database):
        self._stmts = Statements(db)

    def set(
        self, key: str, value: dict[str, Any], by: str | None,
        expected_version: int | None = None,
    ) -> int:
        return self._stmts.upsert_blackboard(
            key, json.dumps(value), by, expected_version
        )

    def get(self, key: str) -> dict | None:
        return self._stmts.get_blackboard(key)

    def delete(self, key: str) -> None:
        self._stmts.delete_blackboard(key)
```

You'll need to import `BlackboardConflictError` into `statements.py` so `upsert_blackboard` can raise it (or move the class to a shared module like `comm/errors.py` if circular import becomes an issue).

- [ ] **Step 5: GREEN, suite + lint.**

- [ ] **Step 6: Commit**

```bash
git add src/visionary/comm/blackboard.py src/visionary/db/statements.py tests/test_blackboard.py
git commit -m "feat(py): blackboard (shared key-value + optimistic concurrency) — Phase 2"
```

---

### Task 6: Direct call (wraps failover)

**Files:**
- Create: `src/visionary/comm/direct.py`
- Create: `tests/test_direct.py`

- [ ] **Step 1: Failing tests**

```python
# tests/test_direct.py
from pathlib import Path

import pytest

from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.comm.direct import Direct
from visionary.runtimes.base import DispatchResult
from visionary.runtimes.registry import Registry


class StubAdapter:
    def __init__(self, name, result):
        self.name = name
        self._result = result

    async def dispatch(self, ctx):
        return DispatchResult(
            ok=self._result.ok, output=self._result.output,
            error=self._result.error, exhausted=self._result.exhausted,
            harness_used=self.name,
        )

    async def healthcheck(self):
        return True


@pytest.fixture
def env(tmp_path: Path):
    db = Database(str(tmp_path / "t.sqlite"))
    run_migrations(db)
    db.execute(
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, "
        "health_status, expected_activity_within_seconds) "
        "VALUES ('scout','Scout','r','claude','claude','ok',3600)"
    )
    reg = Registry()
    reg.register(StubAdapter("claude", DispatchResult(
        ok=True, output="hi", error=None, exhausted=False)))
    yield Direct(db, reg), db
    db.close()


async def test_call_returns_result_dict(env):
    direct, db = env
    r = await direct.call(to="scout", sender="ceo", prompt="hello")
    assert r["ok"] is True
    assert r["output"] == "hi"
    assert r["harness_used"] == "claude"
    assert "trace_id" in r


async def test_call_to_unknown_agent_returns_failure(env):
    direct, db = env
    r = await direct.call(to="ghost", sender="ceo", prompt="hi")
    assert r["ok"] is False
    assert "not found" in (r["error"] or "")
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement Direct**

```python
# src/visionary/comm/direct.py
"""Synchronous agent → agent call.

Wraps execute_with_failover so callers get full harness-chain semantics +
rate-limit + (Phase 1c) token-aware replay. Returns a plain dict, not a
dataclass, so it serializes cleanly over HTTP.
"""

from visionary.comm.envelope import current_trace_id, new_trace_id, with_trace_id
from visionary.db.database import Database
from visionary.runtimes.base import DispatchContext
from visionary.runtimes.failover import execute_with_failover
from visionary.runtimes.registry import Registry


class Direct:
    def __init__(self, db: Database, registry: Registry):
        self._db = db
        self._registry = registry

    async def call(
        self, to: str, sender: str | None, prompt: str,
        timeout_seconds: int = 300,
    ) -> dict:
        tid = current_trace_id() or new_trace_id()
        with with_trace_id(tid):
            ctx = DispatchContext(
                agent_id=to, prompt=prompt, timeout_seconds=timeout_seconds,
            )
            result = await execute_with_failover(self._db, self._registry, to, ctx)
            return {
                "ok": result.ok,
                "output": result.output,
                "error": result.error,
                "harness_used": result.harness_used,
                "duration_ms": result.duration_ms,
                "exhausted": result.exhausted,
                "trace_id": tid,
            }
```

- [ ] **Step 4: GREEN, suite + lint.**

- [ ] **Step 5: Commit**

```bash
git add src/visionary/comm/direct.py tests/test_direct.py
git commit -m "feat(py): direct call (wraps failover with trace_id) — Phase 2"
```

---

### Task 7: Comm facade

**Files:**
- Modify: `src/visionary/comm/__init__.py` — re-export
- Create: `src/visionary/comm/facade.py`
- Create: `tests/test_facade.py`

The facade gives one import surface and ensures every op stamps a trace_id.

- [ ] **Step 1: Failing tests**

```python
# tests/test_facade.py
import json
from pathlib import Path

import pytest

from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.comm.facade import Comm
from visionary.runtimes.base import DispatchResult
from visionary.runtimes.registry import Registry


class StubAdapter:
    name = "claude"

    async def dispatch(self, ctx):
        return DispatchResult(ok=True, output="ok", error=None, exhausted=False)

    async def healthcheck(self):
        return True


@pytest.fixture
def comm(tmp_path: Path):
    db = Database(str(tmp_path / "t.sqlite"))
    run_migrations(db)
    db.execute(
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, "
        "health_status, expected_activity_within_seconds) "
        "VALUES ('scout','Scout','r','claude','claude','ok',3600)"
    )
    db.execute(
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, "
        "health_status, expected_activity_within_seconds) "
        "VALUES ('broker','Broker','a','claude','claude','ok',3600)"
    )
    reg = Registry()
    reg.register(StubAdapter())
    yield Comm(db, reg), db
    db.close()


def test_mail_delegates_to_mailbox(comm):
    c, db = comm
    mid = c.mail(to="scout", sender="broker", subject="hi", body={"x": 1})
    msgs = c.mailbox.list(to="scout")
    assert msgs[0]["id"] == mid


async def test_call_delegates_to_direct(comm):
    c, db = comm
    r = await c.call(to="scout", sender="ceo", prompt="hi")
    assert r["ok"] is True
    assert "trace_id" in r


def test_bb_set_and_get(comm):
    c, db = comm
    c.bb_set("topic.x", {"a": 1}, by="ceo")
    assert json.loads(c.bb_get("topic.x")["value_json"]) == {"a": 1}


async def test_publish_subscribe(comm):
    c, db = comm
    import asyncio
    received: list[dict] = []

    async def consume():
        async for msg in c.pubsub.subscribe(["agent.+"]):
            received.append(msg)
            return

    task = asyncio.create_task(consume())
    await asyncio.sleep(0)
    await c.publish("agent.scout", {"hi": True}, sender="ceo")
    await task
    assert received[0]["topic"] == "agent.scout"
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement Comm**

```python
# src/visionary/comm/facade.py
"""Unified comm facade — single import surface for the 4 lanes.

Constructed once at startup (Lifecycle). Methods auto-stamp trace_id via
the envelope contextvar.
"""

from typing import Any

from visionary.comm.blackboard import Blackboard
from visionary.comm.direct import Direct
from visionary.comm.envelope import current_trace_id, new_trace_id, with_trace_id
from visionary.comm.mailbox import Mailbox
from visionary.comm.pubsub import PubSub
from visionary.db.database import Database
from visionary.runtimes.registry import Registry


class Comm:
    def __init__(self, db: Database, registry: Registry):
        self.mailbox = Mailbox(db)
        self.pubsub = PubSub()
        self.blackboard = Blackboard(db)
        self.direct = Direct(db, registry)

    # --- mailbox ---
    def mail(self, to: str, sender: str | None, subject: str,
             body: dict[str, Any], priority: int = 0,
             thread_id: str | None = None, reply_to: int | None = None) -> int:
        tid = current_trace_id() or new_trace_id()
        with with_trace_id(tid):
            return self.mailbox.send(to, sender, subject, body, priority, thread_id, reply_to)

    # --- pubsub ---
    async def publish(self, topic: str, payload: dict, sender: str = "system") -> None:
        tid = current_trace_id() or new_trace_id()
        with with_trace_id(tid):
            await self.pubsub.publish(topic, payload, sender)

    # --- direct ---
    async def call(self, to: str, sender: str | None, prompt: str,
                   timeout_seconds: int = 300) -> dict:
        return await self.direct.call(to, sender, prompt, timeout_seconds)

    # --- blackboard ---
    def bb_set(self, key: str, value: dict[str, Any], by: str | None,
               expected_version: int | None = None) -> int:
        tid = current_trace_id() or new_trace_id()
        with with_trace_id(tid):
            return self.blackboard.set(key, value, by, expected_version)

    def bb_get(self, key: str) -> dict | None:
        return self.blackboard.get(key)

    def bb_delete(self, key: str) -> None:
        self.blackboard.delete(key)
```

Update `src/visionary/comm/__init__.py`:

```python
from .facade import Comm
from .envelope import current_trace_id, new_trace_id, with_trace_id

__all__ = ["Comm", "current_trace_id", "new_trace_id", "with_trace_id"]
```

- [ ] **Step 4: GREEN, suite + lint.**

- [ ] **Step 5: Commit**

```bash
git add src/visionary/comm/facade.py src/visionary/comm/__init__.py tests/test_facade.py
git commit -m "feat(py): comm facade (unified mailbox/pubsub/direct/blackboard) — Phase 2"
```

---

### Task 8: HTTP routes (mailbox + blackboard)

**Files:**
- Create: `src/visionary/routes/mailbox.py`
- Create: `src/visionary/routes/blackboard.py`
- Create: `tests/test_routes_mailbox.py`
- Create: `tests/test_routes_blackboard.py`
- Modify: `src/visionary/main.py` — register routers
- Modify: `src/visionary/lifecycle.py` — construct `Comm` on `app.state.comm`

- [ ] **Step 1: Update lifecycle**

After Registry + RateLimiter construction:
```python
        from visionary.comm.facade import Comm
        app.state.comm = Comm(db, registry)
```

- [ ] **Step 2: Failing tests**

```python
# tests/test_routes_mailbox.py
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.main import create_app


@pytest.fixture
def temp_env(tmp_path: Path, monkeypatch):
    db = Database(str(tmp_path / "t.sqlite"))
    run_migrations(db)
    db.execute(
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, "
        "health_status, expected_activity_within_seconds) "
        "VALUES ('scout','Scout','r','claude','claude','ok',3600)"
    )
    db.close()
    monkeypatch.setenv("VISIONARY_DB", str(tmp_path / "t.sqlite"))
    pub = tmp_path / "public"
    pub.mkdir()
    (pub / "index.html").write_text("<html></html>")
    monkeypatch.setenv("VISIONARY_PUBLIC", str(pub))


def test_post_then_get_mailbox(temp_env):
    app = create_app()
    with TestClient(app) as client:
        r = client.post(
            "/api/agents/scout/mailbox",
            json={"subject": "hi", "body": {"text": "do X"}, "sender": "broker"},
        )
        assert r.status_code == 200
        mid = r.json()["id"]
        r2 = client.get("/api/agents/scout/mailbox")
        assert r2.status_code == 200
        msgs = r2.json()["messages"]
        assert len(msgs) == 1
        assert msgs[0]["id"] == mid


def test_ack_marks_processed(temp_env):
    app = create_app()
    with TestClient(app) as client:
        r = client.post("/api/agents/scout/mailbox", json={"subject": "x", "body": {}})
        mid = r.json()["id"]
        client.post(f"/api/agents/scout/mailbox/{mid}/ack")
        pending = client.get("/api/agents/scout/mailbox").json()["messages"]
        assert pending == []
```

```python
# tests/test_routes_blackboard.py
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.main import create_app


@pytest.fixture
def temp_env(tmp_path: Path, monkeypatch):
    db = Database(str(tmp_path / "t.sqlite"))
    run_migrations(db)
    db.close()
    monkeypatch.setenv("VISIONARY_DB", str(tmp_path / "t.sqlite"))
    pub = tmp_path / "public"
    pub.mkdir()
    (pub / "index.html").write_text("<html></html>")
    monkeypatch.setenv("VISIONARY_PUBLIC", str(pub))


def test_put_get_delete_blackboard(temp_env):
    app = create_app()
    with TestClient(app) as client:
        r = client.put("/api/blackboard/topic.x", json={"value": {"n": 1}, "by": "ceo"})
        assert r.status_code == 200
        assert r.json()["version"] == 1
        r2 = client.get("/api/blackboard/topic.x")
        assert r2.json()["value"] == {"n": 1}
        client.delete("/api/blackboard/topic.x")
        assert client.get("/api/blackboard/topic.x").status_code == 404


def test_blackboard_get_unknown_returns_404(temp_env):
    app = create_app()
    with TestClient(app) as client:
        r = client.get("/api/blackboard/nope")
        assert r.status_code == 404
```

- [ ] **Step 3: RED.**

- [ ] **Step 4: Implement routes**

```python
# src/visionary/routes/mailbox.py
import json

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()


class SendRequest(BaseModel):
    subject: str
    body: dict
    sender: str | None = None
    priority: int = 0
    thread_id: str | None = None
    reply_to: int | None = None


@router.post("/api/agents/{agent_id}/mailbox")
async def send_message(agent_id: str, req: SendRequest, request: Request) -> dict:
    comm = request.app.state.comm
    mid = comm.mail(
        to=agent_id, sender=req.sender, subject=req.subject, body=req.body,
        priority=req.priority, thread_id=req.thread_id, reply_to=req.reply_to,
    )
    return {"id": mid}


@router.get("/api/agents/{agent_id}/mailbox")
async def list_pending(agent_id: str, request: Request) -> dict:
    comm = request.app.state.comm
    msgs = comm.mailbox.list(to=agent_id)
    # Parse body_json for clients
    for m in msgs:
        try:
            m["body"] = json.loads(m["body_json"])
        except Exception:
            m["body"] = m["body_json"]
    return {"messages": msgs}


@router.post("/api/agents/{agent_id}/mailbox/{mid}/ack")
async def ack_message(agent_id: str, mid: int, request: Request) -> dict:
    comm = request.app.state.comm
    msg = comm.mailbox.get(mid)
    if msg is None or msg["to_agent_id"] != agent_id:
        raise HTTPException(status_code=404, detail="message not found")
    comm.mailbox.mark_processed(mid)
    return {"ok": True, "id": mid}
```

```python
# src/visionary/routes/blackboard.py
import json

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from visionary.comm.blackboard import BlackboardConflictError

router = APIRouter()


class PutRequest(BaseModel):
    value: dict
    by: str | None = None
    expected_version: int | None = None


@router.get("/api/blackboard/{key}")
async def get_bb(key: str, request: Request) -> dict:
    comm = request.app.state.comm
    row = comm.bb_get(key)
    if row is None:
        raise HTTPException(status_code=404, detail=f"key not found: {key}")
    return {
        "key": row["key"],
        "value": json.loads(row["value_json"]),
        "version": row["version"],
        "updated_by": row["updated_by"],
        "updated_at": row["updated_at"],
    }


@router.put("/api/blackboard/{key}")
async def put_bb(key: str, req: PutRequest, request: Request) -> dict:
    comm = request.app.state.comm
    try:
        version = comm.bb_set(key, req.value, req.by, req.expected_version)
    except BlackboardConflictError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"key": key, "version": version}


@router.delete("/api/blackboard/{key}")
async def delete_bb(key: str, request: Request) -> dict:
    comm = request.app.state.comm
    comm.bb_delete(key)
    return {"ok": True, "key": key}
```

- [ ] **Step 5: Register in main.py.**

- [ ] **Step 6: GREEN, suite + lint.**

- [ ] **Step 7: Commit**

```bash
git add src/visionary/routes/mailbox.py src/visionary/routes/blackboard.py src/visionary/main.py src/visionary/lifecycle.py tests/test_routes_mailbox.py tests/test_routes_blackboard.py
git commit -m "feat(py): mailbox + blackboard HTTP routes (comm on app.state) — Phase 2"
```

---

### Task 9: WebSocket `/ws/agent` route

**Files:**
- Create: `src/visionary/routes/ws.py`
- Create: `tests/test_routes_ws.py`
- Modify: `src/visionary/main.py` — register ws router

This wires the PubSub lane to a WebSocket so external agents connect. Protocol mirrors `bridge.py`'s: subscribe / unsubscribe / publish / presence / ping / history.

- [ ] **Step 1: Failing test (smoke only — WS unit tests are tricky)**

```python
# tests/test_routes_ws.py
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.main import create_app


@pytest.fixture
def temp_env(tmp_path: Path, monkeypatch):
    db = Database(str(tmp_path / "t.sqlite"))
    run_migrations(db)
    db.close()
    monkeypatch.setenv("VISIONARY_DB", str(tmp_path / "t.sqlite"))
    pub = tmp_path / "public"
    pub.mkdir()
    (pub / "index.html").write_text("<html></html>")
    monkeypatch.setenv("VISIONARY_PUBLIC", str(pub))


def test_ws_route_registered(temp_env):
    """Verify /ws/agent is in the app's routes (WS end-to-end via TestClient
    is fiddly; that integration belongs in Phase 4 cutover sanity check)."""
    app = create_app()
    paths = {r.path for r in app.routes if hasattr(r, "path")}
    assert "/ws/agent" in paths
```

- [ ] **Step 2: Implement `routes/ws.py`**

```python
# src/visionary/routes/ws.py
"""WebSocket /ws/agent — port of bridge.py's WS protocol.

Protocol messages (JSON):
- {"type": "subscribe",   "topics": ["agent.chat.+"]}
- {"type": "unsubscribe", "topics": ["agent.chat.+"]}
- {"type": "publish",     "topic": "...", "payload": {...}, "from": "..."}
- {"type": "presence",    "agent_id": "scout", "status": "working"}
- {"type": "ping"} / {"type": "pong"}
- {"type": "history",     "topic": "agent.#", "limit": 20}
"""

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger("visionary.routes.ws")
router = APIRouter()


@router.websocket("/ws/agent")
async def ws_agent(websocket: WebSocket) -> None:
    await websocket.accept()
    comm = websocket.app.state.comm
    pubsub = comm.pubsub

    subscriptions: list[str] = []
    consumer_task: asyncio.Task | None = None

    async def fan_in() -> None:
        if not subscriptions:
            return
        try:
            async for msg in pubsub.subscribe(subscriptions):
                await websocket.send_text(json.dumps(msg, default=str))
        except Exception:
            logger.exception("ws consumer error")

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({"type": "error", "error": "invalid JSON"}))
                continue

            t = data.get("type")
            if t == "subscribe":
                topics = data.get("topics") or []
                subscriptions = list({*subscriptions, *topics})
                if consumer_task is None or consumer_task.done():
                    consumer_task = asyncio.create_task(fan_in())
            elif t == "unsubscribe":
                drop = set(data.get("topics") or [])
                subscriptions = [t for t in subscriptions if t not in drop]
            elif t == "publish":
                topic = data.get("topic", "")
                payload = data.get("payload") or {}
                sender = data.get("from") or "anonymous"
                if topic:
                    await comm.publish(topic, payload, sender=sender)
            elif t == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
            elif t == "history":
                topic_filter = data.get("topic", "#")
                limit = min(int(data.get("limit", 20)), 100)
                hist = pubsub.history(topic_filter, limit)
                await websocket.send_text(json.dumps({"type": "history", "messages": hist}, default=str))
            else:
                await websocket.send_text(json.dumps({"type": "error", "error": f"unknown type: {t}"}))
    except WebSocketDisconnect:
        pass
    finally:
        if consumer_task is not None:
            consumer_task.cancel()
```

- [ ] **Step 3: Register in main.py:**

```python
    from visionary.routes import ws as ws_routes
    app.include_router(ws_routes.router)
```

- [ ] **Step 4: GREEN, suite + lint.**

- [ ] **Step 5: Commit**

```bash
git add src/visionary/routes/ws.py src/visionary/main.py tests/test_routes_ws.py
git commit -m "feat(py): /ws/agent WebSocket (mirrors bridge.py protocol) — Phase 2"
```

---

### Task 10: Side-by-side sanity + push + PR

- [ ] **Step 1:** Start uvicorn on 3344. Verify:
  - `POST /api/agents/scout/mailbox` works
  - `GET /api/agents/scout/mailbox` returns the message
  - `PUT /api/blackboard/topic.x` works
  - `GET /api/blackboard/topic.x` returns the value
  - WS endpoint accepts connections (use `websocat ws://127.0.0.1:3344/ws/agent` or `python -c "import asyncio, websockets; ..."`)
- [ ] **Step 2:** Stop uvicorn. Verify Node on 3333 unaffected.
- [ ] **Step 3:** Run pytest, ruff, npm verify — all clean.
- [ ] **Step 4:** Push branch.
- [ ] **Step 5:** Open PR with the standard body referencing the design.

---

## Phase 2 acceptance criteria

- pytest all green
- ruff clean
- npm verify still 22/22
- All 4 comm lanes work via `comm` facade
- HTTP routes for mailbox + blackboard respond
- WS `/ws/agent` registered
- Node on 3333 unaffected throughout
- PR opened against `main`

When Phase 2 lands: **all 4 goal pillars delivered.** Phase 3 (absorb watchdog + bridge into the FastAPI process) can then close the migration story.
