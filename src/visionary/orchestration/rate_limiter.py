# src/visionary/orchestration/rate_limiter.py
"""Per-agent token bucket throttle.

Config persists in `settings` under key `rate_limit:<agent_id>`. Counters
are in-memory (single-user, single-process). On `RateLimiter()` construction
we lazily hydrate caps from settings on first use; defaults if no setting.
"""

import json
import time
from typing import Any

from visionary.db.database import Database
from visionary.db.statements import Statements

DEFAULT_CAPACITY = 10
DEFAULT_REFILL_PER_SECOND = 1.0


def _key(agent_id: str) -> str:
    return f"rate_limit:{agent_id}"


class _Bucket:
    __slots__ = ("capacity", "refill_per_second", "tokens", "last_refill_ts")

    def __init__(self, capacity: int, refill_per_second: float):
        self.capacity = capacity
        self.refill_per_second = refill_per_second
        self.tokens = float(capacity)
        self.last_refill_ts = time.monotonic()


class RateLimiter:
    def __init__(self, db: Database):
        self._db = db
        self._stmts = Statements(db)
        self._buckets: dict[str, _Bucket] = {}

    def _get_or_load(self, agent_id: str) -> _Bucket:
        if agent_id not in self._buckets:
            row = self._stmts.get_setting(_key(agent_id))
            if row is not None:
                cfg = json.loads(row["value_json"])
                cap = int(cfg.get("capacity", DEFAULT_CAPACITY))
                rate = float(cfg.get("refill_per_second", DEFAULT_REFILL_PER_SECOND))
            else:
                cap = DEFAULT_CAPACITY
                rate = DEFAULT_REFILL_PER_SECOND
            self._buckets[agent_id] = _Bucket(cap, rate)
        return self._buckets[agent_id]

    def _refill(self, bucket: _Bucket) -> None:
        now = time.monotonic()
        elapsed = now - bucket.last_refill_ts
        if elapsed <= 0:
            return
        bucket.tokens = min(bucket.capacity, bucket.tokens + elapsed * bucket.refill_per_second)
        bucket.last_refill_ts = now

    def acquire(self, agent_id: str) -> bool:
        bucket = self._get_or_load(agent_id)
        self._refill(bucket)
        if bucket.tokens >= 1.0:
            bucket.tokens -= 1.0
            return True
        return False

    def configure(self, agent_id: str, capacity: int, refill_per_second: float) -> None:
        self._stmts.upsert_setting(
            _key(agent_id),
            json.dumps({"capacity": capacity, "refill_per_second": refill_per_second}),
        )
        bucket = _Bucket(capacity, refill_per_second)
        self._buckets[agent_id] = bucket

    def status(self, agent_id: str) -> dict[str, Any]:
        bucket = self._get_or_load(agent_id)
        self._refill(bucket)
        return {
            "capacity": bucket.capacity,
            "refill_per_second": bucket.refill_per_second,
            "tokens": bucket.tokens,
        }
