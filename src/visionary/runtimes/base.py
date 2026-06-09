"""Runtime adapter Protocol + dataclasses.

Adapters implement `dispatch(ctx) -> DispatchResult` (async) and
`healthcheck() -> bool` (async). Each represents one CLI harness
(`claude -p`, `openclaw run`, etc).
"""

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class DispatchContext:
    """Everything an adapter needs to perform one call."""

    agent_id: str
    prompt: str
    model: str | None = None
    max_turns: int = 20
    allowed_tools: list[str] = field(default_factory=list)
    timeout_seconds: int = 300
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class DispatchResult:
    ok: bool
    output: str
    error: str | None
    exhausted: bool = False
    harness_used: str | None = None
    duration_ms: int | None = None


class RuntimeAdapter(Protocol):
    name: str

    async def dispatch(self, ctx: DispatchContext) -> DispatchResult: ...
    async def healthcheck(self) -> bool: ...
