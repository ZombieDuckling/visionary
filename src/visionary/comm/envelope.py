"""Common envelope + trace_id contextvar for the comm fabric.

Every comm op (mailbox.send, pubsub.publish, direct.call, bb_set) carries
a trace_id. Code paths use `with with_trace_id(tid):` to scope a trace.
"""

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any, Iterator
from uuid import uuid4


@dataclass
class Envelope:
    from_: str | None
    to: str | None
    topic: str | None
    key: str | None
    type: str
    payload: dict[str, Any]
    trace_id: str | None


_trace_id_var: ContextVar[str | None] = ContextVar("visionary_trace_id", default=None)


def new_trace_id() -> str:
    return uuid4().hex


def current_trace_id() -> str | None:
    return _trace_id_var.get()


@contextmanager
def with_trace_id(trace_id: str) -> Iterator[None]:
    token = _trace_id_var.set(trace_id)
    try:
        yield
    finally:
        _trace_id_var.reset(token)
