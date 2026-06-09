"""Prepared-statement repository.

All SQL the routes use lives here as named methods. This mirrors the Node
side's `db.js` discipline: no inline SQL in route handlers.
"""

from typing import Any

from visionary.db.database import Database


class Statements:
    def __init__(self, db: Database):
        self._db = db

    # --- agents ---
    def get_agent_by_id(self, agent_id: str) -> dict[str, Any] | None:
        return self._db.query_one("SELECT * FROM agents WHERE id = ?", [agent_id])

    def list_agents(self) -> list[dict[str, Any]]:
        return self._db.query("SELECT * FROM agents ORDER BY name")

    # --- schedules ---
    def list_schedules(self) -> list[dict[str, Any]]:
        return self._db.query("SELECT * FROM schedules ORDER BY id")

    # --- settings ---
    def get_setting(self, key: str) -> dict[str, Any] | None:
        return self._db.query_one(
            "SELECT key, value_json FROM settings WHERE key = ?", [key]
        )

    # --- settings (upsert) ---
    def upsert_setting(self, key: str, value_json: str) -> None:
        self._db.execute(
            "INSERT INTO settings (key, value_json) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, "
            "updated_at = datetime('now')",
            [key, value_json],
        )
