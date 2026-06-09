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

    # --- agent_messages ---
    def insert_agent_message(
        self, agent_id: str, role: str, content: str, harness: str | None = None
    ) -> None:
        self._db.execute(
            "INSERT INTO agent_messages (agent_id, role, content, harness) "
            "VALUES (?, ?, ?, ?)",
            [agent_id, role, content, harness],
        )

    def list_recent_messages(
        self, agent_id: str, limit: int = 50
    ) -> list[dict]:
        return self._db.query(
            "SELECT role, content, harness, created_at FROM agent_messages "
            "WHERE agent_id = ? ORDER BY id DESC LIMIT ?",
            [agent_id, limit],
        )

    # --- agents (runtime state mutation) ---
    def update_agent_harness(self, agent_id: str, current_harness: str) -> None:
        self._db.execute(
            "UPDATE agents SET current_harness = ?, updated_at = datetime('now') "
            "WHERE id = ?",
            [current_harness, agent_id],
        )

    def update_agent_health(self, agent_id: str, health_status: str) -> None:
        self._db.execute(
            "UPDATE agents SET health_status = ?, "
            "last_activity_at = datetime('now'), updated_at = datetime('now') "
            "WHERE id = ?",
            [health_status, agent_id],
        )

    # --- agent_health_log ---
    def insert_agent_health_log(
        self, agent_id: str, status: str, detail: str | None = None
    ) -> None:
        self._db.execute(
            "INSERT INTO agent_health_log (agent_id, status, detail) "
            "VALUES (?, ?, ?)",
            [agent_id, status, detail],
        )
