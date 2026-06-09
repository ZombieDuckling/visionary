"""Shared key-value with optimistic concurrency.

Each `set` either creates a new row (version=1) or updates with version+1.
If `expected_version` is supplied, mismatch raises BlackboardConflictError.
"""

import json
from typing import Any

from visionary.db.database import Database
from visionary.db.statements import Statements


class BlackboardConflictError(Exception):
    pass


class Blackboard:
    def __init__(self, db: Database):
        self._stmts = Statements(db)

    def set(
        self, key: str, value: dict[str, Any], by: str | None,
        expected_version: int | None = None,
    ) -> int:
        return self._stmts.upsert_blackboard(
            key, json.dumps(value), by, expected_version
        )

    def get(self, key: str) -> dict | None:
        return self._stmts.get_blackboard(key)

    def delete(self, key: str) -> None:
        self._stmts.delete_blackboard(key)
