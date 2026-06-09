from pathlib import Path

from visionary.db import Database
from visionary.db.migrations import MIGRATIONS, run_migrations


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


def test_migrations_list_has_8_entries():
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
