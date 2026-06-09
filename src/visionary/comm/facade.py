"""Unified comm facade — single import surface for the 4 lanes.

Constructed once at startup (Lifecycle). Methods auto-stamp trace_id via
the envelope contextvar.
"""

from typing import Any

from visionary.comm.blackboard import Blackboard
from visionary.comm.direct import Direct
from visionary.comm.envelope import current_trace_id, new_trace_id, with_trace_id
from visionary.comm.mailbox import Mailbox
from visionary.comm.pubsub import PubSub
from visionary.db.database import Database
from visionary.runtimes.registry import Registry


class Comm:
    def __init__(self, db: Database, registry: Registry):
        self.mailbox = Mailbox(db)
        self.pubsub = PubSub()
        self.blackboard = Blackboard(db)
        self.direct = Direct(db, registry)

    # --- mailbox ---
    def mail(
        self, to: str, sender: str | None, subject: str,
        body: dict[str, Any], priority: int = 0,
        thread_id: str | None = None, reply_to: int | None = None,
    ) -> int:
        tid = current_trace_id() or new_trace_id()
        with with_trace_id(tid):
            return self.mailbox.send(
                to, sender, subject, body, priority, thread_id, reply_to
            )

    # --- pubsub ---
    async def publish(self, topic: str, payload: dict, sender: str = "system") -> None:
        tid = current_trace_id() or new_trace_id()
        with with_trace_id(tid):
            await self.pubsub.publish(topic, payload, sender)

    # --- direct ---
    async def call(
        self, to: str, sender: str | None, prompt: str,
        timeout_seconds: int = 300,
    ) -> dict:
        return await self.direct.call(to, sender, prompt, timeout_seconds)

    # --- blackboard ---
    def bb_set(
        self, key: str, value: dict[str, Any], by: str | None,
        expected_version: int | None = None,
    ) -> int:
        tid = current_trace_id() or new_trace_id()
        with with_trace_id(tid):
            return self.blackboard.set(key, value, by, expected_version)

    def bb_get(self, key: str) -> dict | None:
        return self.blackboard.get(key)

    def bb_delete(self, key: str) -> None:
        self.blackboard.delete(key)
