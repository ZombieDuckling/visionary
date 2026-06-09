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

    @contextmanager
    def savepoint(self, name: str) -> Iterator[None]:
        """Atomic SAVEPOINT block. Use when running DDL or executescript
        inside an outer transaction is not feasible (executescript implicitly
        commits in legacy mode). Releases on success, ROLLBACK TO on error.
        """
        if not name.replace("_", "").isalnum():
            raise ValueError(f"Invalid savepoint name: {name!r}")
        self._conn.execute(f"SAVEPOINT {name}")
        try:
            yield
            self._conn.execute(f"RELEASE SAVEPOINT {name}")
        except Exception:
            self._conn.execute(f"ROLLBACK TO SAVEPOINT {name}")
            self._conn.execute(f"RELEASE SAVEPOINT {name}")
            raise

    def close(self) -> None:
        self._conn.close()
