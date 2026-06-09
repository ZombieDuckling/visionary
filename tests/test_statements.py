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
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, "
        "health_status, expected_activity_within_seconds) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["a", "A", "r", "openclaw", "openclaw", "ok", 3600],
    )
    db.execute(
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, "
        "health_status, expected_activity_within_seconds) "
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
        [1, "Morning brief", "0 8 * * *", "scout", "research overnight", 1],
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
