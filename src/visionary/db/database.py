import sqlite3
from contextlib import contextmanager
from typing import Any, Iterator


class Database:
    """Thin wrapper around sqlite3 with WAL, queries, and a transaction context.

    Mirrors better-sqlite3's discipline on the Node side: prepared SQL only,
    no inline SQL in route handlers (prepared statements will live in
    statements.py in Phase 1).
    """

    def __init__(self, path: str):
        self._conn = sqlite3.connect(path, isolation_level=None, timeout=5)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode = WAL")
        self._conn.execute("PRAGMA busy_timeout = 5000")
        self._conn.execute("PRAGMA foreign_keys = ON")

    def execute(self, sql: str, params: list[Any] | None = None) -> sqlite3.Cursor:
        return self._conn.execute(sql, params or [])

    def executescript(self, sql: str) -> None:
        self._conn.executescript(sql)

    def query(self, sql: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
        cursor = self._conn.execute(sql, params or [])
        return [dict(row) for row in cursor.fetchall()]

    def query_one(self, sql: str, params: list[Any] | None = None) -> dict[str, Any] | None:
        cursor = self._conn.execute(sql, params or [])
        row = cursor.fetchone()
        return dict(row) if row else None

    @contextmanager
    def transaction(self) -> Iterator[None]:
        self._conn.execute("BEGIN")
        try:
            yield
            self._conn.execute("COMMIT")
        except Exception:
            self._conn.execute("ROLLBACK")
            raise

    def close(self) -> None:
        self._conn.close()
