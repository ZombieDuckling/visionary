from pathlib import Path

import pytest

from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.runtimes.base import DispatchContext, DispatchResult
from visionary.runtimes.failover import execute_with_failover
from visionary.runtimes.registry import Registry


class StubAdapter:
    def __init__(self, name: str, result: DispatchResult):
        self.name = name
        self._result = result
        self.calls = 0

    async def dispatch(self, ctx: DispatchContext) -> DispatchResult:
        self.calls += 1
        r = self._result
        return DispatchResult(
            ok=r.ok, output=r.output, error=r.error, exhausted=r.exhausted,
            harness_used=self.name, duration_ms=r.duration_ms,
        )

    async def healthcheck(self) -> bool:
        return True


@pytest.fixture
def db(tmp_path: Path):
    d = Database(str(tmp_path / "t.sqlite"))
    run_migrations(d)
    d.execute(
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, "
        "health_status, expected_activity_within_seconds) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["scout", "Scout", "researcher", "claude,openclaw", "claude", "ok", 3600],
    )
    yield d
    d.close()


async def test_success_on_first_harness(db):
    reg = Registry()
    reg.register(StubAdapter("claude", DispatchResult(
        ok=True, output="hi from claude", error=None, exhausted=False)))
    reg.register(StubAdapter("openclaw", DispatchResult(
        ok=True, output="should not run", error=None, exhausted=False)))

    ctx = DispatchContext(agent_id="scout", prompt="hello")
    r = await execute_with_failover(db, reg, "scout", ctx)
    assert r.ok is True
    assert "hi from claude" in r.output
    assert r.harness_used == "claude"


async def test_failover_to_next_on_exhaustion(db):
    claude_stub = StubAdapter("claude", DispatchResult(
        ok=False, output="", error="rate limit", exhausted=True))
    openclaw_stub = StubAdapter("openclaw", DispatchResult(
        ok=True, output="hi from openclaw", error=None, exhausted=False))
    reg = Registry()
    reg.register(claude_stub)
    reg.register(openclaw_stub)

    ctx = DispatchContext(agent_id="scout", prompt="hello")
    r = await execute_with_failover(db, reg, "scout", ctx)
    assert r.ok is True
    assert "openclaw" in r.output
    assert claude_stub.calls == 1
    assert openclaw_stub.calls == 1

    row = db.query_one("SELECT current_harness FROM agents WHERE id = ?", ["scout"])
    assert row["current_harness"] == "openclaw"


async def test_all_exhausted_returns_failure(db):
    reg = Registry()
    reg.register(StubAdapter("claude", DispatchResult(
        ok=False, output="", error="rate limit", exhausted=True)))
    reg.register(StubAdapter("openclaw", DispatchResult(
        ok=False, output="", error="quota exceeded", exhausted=True)))

    ctx = DispatchContext(agent_id="scout", prompt="hello")
    r = await execute_with_failover(db, reg, "scout", ctx)
    assert r.ok is False
    assert r.exhausted is True

    row = db.query_one("SELECT health_status FROM agents WHERE id = ?", ["scout"])
    assert row["health_status"] == "fail"


async def test_unknown_harness_is_skipped(db):
    db.execute("UPDATE agents SET harness_chain = ? WHERE id = ?",
               ["nonexistent,openclaw", "scout"])
    db.execute("UPDATE agents SET current_harness = ? WHERE id = ?",
               ["nonexistent", "scout"])
    reg = Registry()
    reg.register(StubAdapter("openclaw", DispatchResult(
        ok=True, output="from openclaw", error=None, exhausted=False)))

    ctx = DispatchContext(agent_id="scout", prompt="hi")
    r = await execute_with_failover(db, reg, "scout", ctx)
    assert r.ok is True
    assert r.harness_used == "openclaw"


async def test_persists_turns_to_agent_messages(db):
    reg = Registry()
    reg.register(StubAdapter("claude", DispatchResult(
        ok=True, output="reply text", error=None, exhausted=False)))

    ctx = DispatchContext(agent_id="scout", prompt="my prompt")
    await execute_with_failover(db, reg, "scout", ctx)

    rows = db.query(
        "SELECT role, content FROM agent_messages WHERE agent_id = ? ORDER BY id",
        ["scout"],
    )
    assert len(rows) == 2
    assert rows[0]["role"] == "user"
    assert rows[0]["content"] == "my prompt"
    assert rows[1]["role"] == "assistant"
    assert rows[1]["content"] == "reply text"
