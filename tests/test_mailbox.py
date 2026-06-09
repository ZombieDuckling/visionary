# tests/test_mailbox.py
import json
from pathlib import Path

import pytest

from visionary.comm.mailbox import Mailbox
from visionary.db import Database
from visionary.db.migrations import run_migrations


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
    mailbox, _ = mb
    mid = mailbox.send(to="scout", sender="broker", subject="task",
                       body={"text": "do X"}, priority=1)
    msgs = mailbox.list(to="scout")
    assert len(msgs) == 1
    assert msgs[0]["id"] == mid
    assert msgs[0]["subject"] == "task"
    assert json.loads(msgs[0]["body_json"]) == {"text": "do X"}
    assert msgs[0]["priority"] == 1


def test_mark_read_moves_status(mb):
    mailbox, _ = mb
    mid = mailbox.send(to="scout", sender=None, subject="hi", body={})
    mailbox.mark_read(mid)
    pending = mailbox.list(to="scout", status="pending")
    assert pending == []
    read = mailbox.list(to="scout", status="read")
    assert len(read) == 1


def test_mark_processed_terminal(mb):
    mailbox, _ = mb
    mid = mailbox.send(to="scout", sender=None, subject="hi", body={})
    mailbox.mark_processed(mid)
    processed = mailbox.list(to="scout", status="processed")
    assert len(processed) == 1


def test_thread_groups_messages(mb):
    mailbox, _ = mb
    a = mailbox.send(to="scout", sender="broker", subject="A", body={}, thread_id="th-1")
    b = mailbox.send(to="scout", sender="broker", subject="B", body={}, thread_id="th-1")
    thread = mailbox.thread("th-1")
    assert {m["id"] for m in thread} == {a, b}


def test_priority_orders_list(mb):
    mailbox, _ = mb
    mailbox.send(to="scout", sender=None, subject="low", body={}, priority=0)
    mailbox.send(to="scout", sender=None, subject="high", body={}, priority=2)
    mailbox.send(to="scout", sender=None, subject="med", body={}, priority=1)
    msgs = mailbox.list(to="scout")
    subs = [m["subject"] for m in msgs]
    assert subs == ["high", "med", "low"]
