import sqlite3
from pathlib import Path

import pytest

from visionary.db import Database
from visionary.db.migrations import MIGRATIONS, run_migrations


def test_run_migrations_against_empty_db_applies_all(tmp_path: Path):
    db = Database(str(tmp_path / "test.sqlite"))
    final = run_migrations(db)
    assert final == len(MIGRATIONS)
    version_row = db.query_one("SELECT version FROM schema_version")
    assert version_row is not None
    assert version_row["version"] == len(MIGRATIONS)
    db.close()


def test_run_migrations_is_idempotent(tmp_path: Path):
    db = Database(str(tmp_path / "test.sqlite"))
    first = run_migrations(db)
    second = run_migrations(db)
    assert first == second
    db.close()


def test_run_migrations_creates_core_tables(tmp_path: Path):
    db = Database(str(tmp_path / "test.sqlite"))
    run_migrations(db)
    tables = {
        row["name"]
        for row in db.query(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        )
    }
    expected = {
        "schema_version",
        "projects",
        "tasks",
        "agent_runs",
        "notifications",
        "activity_log",
        "interview_sessions",
        "agents",
        "settings",
        "spaces",
        "agent_messages",
        "agent_health_log",
        "schedules",
    }
    missing = expected - tables
    assert not missing, f"Missing tables: {missing}"
    db.close()


def test_migration_7_adds_last_nudge_at_column(tmp_path: Path):
    db = Database(str(tmp_path / "test.sqlite"))
    run_migrations(db)
    cols = {row["name"] for row in db.query("PRAGMA table_info(agents)")}
    assert "last_nudge_at" in cols
    db.close()


def test_migration_7_seeds_watchdog_settings(tmp_path: Path):
    db = Database(str(tmp_path / "test.sqlite"))
    run_migrations(db)
    row = db.query_one("SELECT value_json FROM settings WHERE key = ?", ["watchdog"])
    assert row is not None


def test_run_migrations_against_live_db_is_noop(tmp_path: Path):
    """If the live visionary.sqlite (already at version 7) is fed in, no migrations re-apply."""
    import shutil

    repo_root = Path(__file__).resolve().parent.parent
    live_db = repo_root / "visionary.sqlite"
    if not live_db.exists():
        pytest.skip("Live visionary.sqlite not present (CI / fresh checkout)")
    target = tmp_path / "live-copy.sqlite"
    shutil.copy(live_db, target)
    db = Database(str(target))
    final = run_migrations(db)
    assert final == len(MIGRATIONS), (
        f"Expected port-run to no-op at version {len(MIGRATIONS)}, got {final}"
    )
    db.close()


def test_run_migrations_rollback_on_failure(tmp_path: Path, monkeypatch):
    """If a migration's SQL has a syntax error, the partial work must roll back."""
    import visionary.db.migrations as m

    db = Database(str(tmp_path / "test.sqlite"))
    # Inject a bogus migration after all real ones to force a SQL error.
    bogus = (len(m.MIGRATIONS) + 1, "CREATE TABLE leaks (id INTEGER); INTENTIONAL SYNTAX ERROR;")
    monkeypatch.setattr(m, "MIGRATIONS", list(m.MIGRATIONS) + [bogus])

    with pytest.raises(sqlite3.OperationalError):
        run_migrations(db)

    # If atomicity holds, schema_version must NOT have advanced past the last real migration
    # AND the 'leaks' table must NOT exist.
    real_max = len(m.MIGRATIONS) - 1  # the bogus migration we appended is at the end
    version_row = db.query_one("SELECT version FROM schema_version")
    assert version_row["version"] == real_max
    tables = {row["name"] for row in db.query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    )}
    assert "leaks" not in tables, "Bogus migration leaked tables — atomicity broken!"
    db.close()
