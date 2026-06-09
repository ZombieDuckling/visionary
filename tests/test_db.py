from pathlib import Path

import pytest

from visionary.db import Database


def test_database_executes_and_queries(tmp_path: Path):
    db = Database(str(tmp_path / "test.sqlite"))
    db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)")
    db.execute("INSERT INTO t (name) VALUES (?)", ["alice"])
    db.execute("INSERT INTO t (name) VALUES (?)", ["bob"])
    rows = db.query("SELECT * FROM t ORDER BY id")
    assert rows == [{"id": 1, "name": "alice"}, {"id": 2, "name": "bob"}]
    one = db.query_one("SELECT * FROM t WHERE name = ?", ["alice"])
    assert one == {"id": 1, "name": "alice"}
    missing = db.query_one("SELECT * FROM t WHERE name = ?", ["nope"])
    assert missing is None
    db.close()


def test_database_transaction_commits(tmp_path: Path):
    db = Database(str(tmp_path / "test.sqlite"))
    db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)")
    with db.transaction():
        db.execute("INSERT INTO t (name) VALUES (?)", ["committed"])
    rows = db.query("SELECT name FROM t")
    assert [r["name"] for r in rows] == ["committed"]
    db.close()


def test_database_transaction_rolls_back_on_error(tmp_path: Path):
    db = Database(str(tmp_path / "test.sqlite"))
    db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)")
    with pytest.raises(ValueError):
        with db.transaction():
            db.execute("INSERT INTO t (name) VALUES (?)", ["rolledback"])
            raise ValueError("boom")
    rows = db.query("SELECT name FROM t")
    assert rows == []
    db.close()


def test_database_enables_wal_mode(tmp_path: Path):
    db = Database(str(tmp_path / "test.sqlite"))
    mode = db.query_one("PRAGMA journal_mode")
    assert mode is not None
    assert mode.get("journal_mode") == "wal"
    db.close()
