"""Adapter for the `openclaw` CLI.

Reads the binary path from `OPENCLAW_BIN` env var (default: `openclaw` on PATH).
"""

import asyncio
import os
import time
from typing import ClassVar

from .base import DispatchContext, DispatchResult

_EXHAUSTION_MARKERS: tuple[str, ...] = (
    "rate limit",
    "rate-limit",
    "token limit",
    "quota",
    "weekly limit",
    "insufficient credit",
    "payment required",
    "429",
    "exceeded",
)


class OpenClawAdapter:
    name: ClassVar[str] = "openclaw"

    def _bin(self) -> str:
        return os.environ.get("OPENCLAW_BIN", "openclaw")

    async def dispatch(self, ctx: DispatchContext) -> DispatchResult:
        start = time.monotonic()
        args = [self._bin(), "run", "--prompt", ctx.prompt]

        try:
            proc = await asyncio.create_subprocess_exec(
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=ctx.timeout_seconds
            )
        except FileNotFoundError:
            return DispatchResult(
                ok=False, output="", error=f"openclaw binary not found: {self._bin()}",
                exhausted=False, harness_used=self.name,
            )
        except asyncio.TimeoutError:
            return DispatchResult(
                ok=False, output="", error="openclaw dispatch timed out",
                exhausted=False, harness_used=self.name,
            )

        out = stdout.decode(errors="replace")
        err = stderr.decode(errors="replace")
        duration_ms = int((time.monotonic() - start) * 1000)

        if proc.returncode == 0:
            return DispatchResult(
                ok=True, output=out, error=None,
                exhausted=False, harness_used=self.name, duration_ms=duration_ms,
            )

        exhausted = any(marker in err.lower() for marker in _EXHAUSTION_MARKERS)
        return DispatchResult(
            ok=False, output=out, error=err.strip() or f"exit {proc.returncode}",
            exhausted=exhausted, harness_used=self.name, duration_ms=duration_ms,
        )

    async def healthcheck(self) -> bool:
        try:
            proc = await asyncio.create_subprocess_exec(
                self._bin(), "--version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await asyncio.wait_for(proc.communicate(), timeout=3)
            return proc.returncode == 0
        except (FileNotFoundError, asyncio.TimeoutError, PermissionError):
            return False
