"""Durable inbox queue. Each message persists in agent_mailbox."""

from __future__ import annotations

import json
from typing import Any

from visionary.comm.envelope import current_trace_id
from visionary.db.database import Database
from visionary.db.statements import Statements


class Mailbox:
    def __init__(self, db: Database):
        self._stmts = Statements(db)

    def send(
        self, to: str, sender: str | None, subject: str,
        body: dict[str, Any], priority: int = 0,
        thread_id: str | None = None, reply_to: int | None = None,
    ) -> int:
        return self._stmts.insert_mailbox_message(
            to_agent_id=to, from_agent_id=sender,
            subject=subject, body_json=json.dumps(body), priority=priority,
            thread_id=thread_id, reply_to=reply_to,
            trace_id=current_trace_id(),
        )

    def list(self, to: str, status: str = "pending", limit: int = 50) -> list[dict]:
        return self._stmts.list_mailbox(to, status, limit)

    def get(self, mid: int) -> dict | None:
        return self._stmts.get_mailbox_message(mid)

    def mark_read(self, mid: int) -> None:
        self._stmts.mark_mailbox_read(mid)

    def mark_processed(self, mid: int) -> None:
        self._stmts.mark_mailbox_processed(mid)

    def thread(self, thread_id: str, limit: int = 100) -> list[dict]:
        return self._stmts.list_thread(thread_id, limit)
