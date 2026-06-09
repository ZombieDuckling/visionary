import json
from pathlib import Path

import pytest

from visionary.comm.blackboard import Blackboard, BlackboardConflictError
from visionary.db import Database
from visionary.db.migrations import run_migrations


@pytest.fixture
def bb(tmp_path: Path):
    db = Database(str(tmp_path / "t.sqlite"))
    run_migrations(db)
    yield Blackboard(db), db
    db.close()


def test_set_then_get(bb):
    blackboard, _ = bb
    v = blackboard.set("topic.brief.id", {"id": 42}, by="ceo")
    assert v == 1
    row = blackboard.get("topic.brief.id")
    assert json.loads(row["value_json"]) == {"id": 42}
    assert row["version"] == 1
    assert row["updated_by"] == "ceo"


def test_set_again_increments_version(bb):
    blackboard, _ = bb
    blackboard.set("x", {"n": 1}, by="ceo")
    v2 = blackboard.set("x", {"n": 2}, by="ceo")
    assert v2 == 2
    assert blackboard.get("x")["version"] == 2


def test_optimistic_concurrency_conflict(bb):
    blackboard, _ = bb
    blackboard.set("y", {"n": 1}, by="ceo")
    # Simulate another writer bumping version
    blackboard.set("y", {"n": 2}, by="someone")
    # Our local expected is still 1 → conflict
    with pytest.raises(BlackboardConflictError):
        blackboard.set("y", {"n": 99}, by="ceo", expected_version=1)


def test_delete_removes_row(bb):
    blackboard, _ = bb
    blackboard.set("z", {}, by="ceo")
    assert blackboard.get("z") is not None
    blackboard.delete("z")
    assert blackboard.get("z") is None
