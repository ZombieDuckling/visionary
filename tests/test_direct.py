from pathlib import Path

import pytest

from visionary.comm.direct import Direct
from visionary.db import Database
from visionary.db.migrations import run_migrations
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
    direct, _ = env
    r = await direct.call(to="scout", sender="ceo", prompt="hello")
    assert r["ok"] is True
    assert r["output"] == "hi"
    assert r["harness_used"] == "claude"
    assert "trace_id" in r
    assert isinstance(r["trace_id"], str) and len(r["trace_id"]) > 0


async def test_call_to_unknown_agent_returns_failure(env):
    direct, _ = env
    r = await direct.call(to="ghost", sender="ceo", prompt="hi")
    assert r["ok"] is False
    assert "not found" in (r["error"] or "")
