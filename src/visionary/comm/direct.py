"""Synchronous agent → agent call.

Wraps execute_with_failover so callers get full harness-chain semantics +
rate-limit + (future) token-aware replay. Returns a plain dict, not a
dataclass, so it serializes cleanly over HTTP.
"""

from visionary.comm.envelope import current_trace_id, new_trace_id, with_trace_id
from visionary.db.database import Database
from visionary.runtimes.base import DispatchContext
from visionary.runtimes.failover import execute_with_failover
from visionary.runtimes.registry import Registry


class Direct:
    def __init__(self, db: Database, registry: Registry):
        self._db = db
        self._registry = registry

    async def call(
        self, to: str, sender: str | None, prompt: str,
        timeout_seconds: int = 300,
    ) -> dict:
        tid = current_trace_id() or new_trace_id()
        with with_trace_id(tid):
            ctx = DispatchContext(
                agent_id=to, prompt=prompt, timeout_seconds=timeout_seconds,
            )
            result = await execute_with_failover(self._db, self._registry, to, ctx)
            return {
                "ok": result.ok,
                "output": result.output,
                "error": result.error,
                "harness_used": result.harness_used,
                "duration_ms": result.duration_ms,
                "exhausted": result.exhausted,
                "trace_id": tid,
            }
