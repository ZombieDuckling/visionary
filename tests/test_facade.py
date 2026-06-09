import asyncio
import json
from pathlib import Path

import pytest

from visionary.comm.facade import Comm
from visionary.db import Database
from visionary.db.migrations import run_migrations
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
    c, _ = comm
    mid = c.mail(to="scout", sender="broker", subject="hi", body={"x": 1})
    msgs = c.mailbox.list(to="scout")
    assert msgs[0]["id"] == mid


async def test_call_delegates_to_direct(comm):
    c, _ = comm
    r = await c.call(to="scout", sender="ceo", prompt="hi")
    assert r["ok"] is True
    assert "trace_id" in r


def test_bb_set_and_get(comm):
    c, _ = comm
    c.bb_set("topic.x", {"a": 1}, by="ceo")
    assert json.loads(c.bb_get("topic.x")["value_json"]) == {"a": 1}


async def test_publish_subscribe(comm):
    c, _ = comm
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
