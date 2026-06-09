# Python Backend Migration — Phase 1b: Dispatch + Failover engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Implement the harness-switching agent dispatch path in Python — rate limiter, guardrails (token budget + replay selection), cookbook (context window lookup), 2 runtime adapters (claude, openclaw), failover engine that walks a harness chain on exhaustion, and HTTP routes for dispatch, health-check, and throttle. **This delivers "ability to call and switch agent harnesses" from the session goal.**

**Architecture:** All orchestration code under `src/visionary/orchestration/`. Runtime adapters under `src/visionary/runtimes/` implement a common protocol. `failover.execute_with_failover()` is the single entry point used by the dispatch route. Rate-limit config persists in `settings` table under `rate_limit:<agent_id>` keys (matches Node-side pattern from PR #22).

**Tech stack:** No new pip deps. CLIs (`claude`, `openclaw`) invoked via `asyncio.create_subprocess_exec` (the async equivalent of Node's `execFile`).

**Spec reference:** `docs/superpowers/specs/2026-06-09-python-backend-design.md` §3, §5.3 (direct call), §7 Phase 1.

**Prior contracts:**
- `Database` + savepoints, `Settings`, `Statements` from Phase 0/1a
- `EventBus` on `app.state.event_bus`
- Pydantic models package

---

## File structure (Phase 1b)

**Files created:**
- `src/visionary/orchestration/__init__.py`
- `src/visionary/orchestration/cookbook.py` — context window per harness
- `src/visionary/orchestration/guardrails.py` — token estimate + replay selection
- `src/visionary/orchestration/rate_limiter.py` — per-agent token bucket
- `src/visionary/runtimes/__init__.py`
- `src/visionary/runtimes/base.py` — `RuntimeAdapter` protocol + dataclasses
- `src/visionary/runtimes/claude.py` — `claude` CLI adapter
- `src/visionary/runtimes/openclaw.py` — `openclaw` CLI adapter
- `src/visionary/runtimes/registry.py` — name → adapter registry
- `src/visionary/runtimes/failover.py` — `execute_with_failover`
- `src/visionary/routes/dispatch.py` — POST /api/agents/{id}/dispatch
- `src/visionary/routes/health.py` — POST /api/agents/{id}/health-check
- `src/visionary/routes/throttle.py` — GET/PUT /api/agents/{id}/throttle
- `tests/test_cookbook.py`
- `tests/test_guardrails.py`
- `tests/test_rate_limiter.py`
- `tests/test_runtimes_base.py`
- `tests/test_runtimes_claude.py` — uses stub CLI
- `tests/test_runtimes_openclaw.py` — uses stub CLI
- `tests/test_failover.py`
- `tests/test_routes_dispatch.py`
- `tests/test_routes_health.py`
- `tests/test_routes_throttle.py`

**Files modified:**
- `src/visionary/db/statements.py` — add agent_messages insert + health_log insert + setting upsert
- `src/visionary/main.py` — register the 3 new routers
- `src/visionary/db/migrations.py` — NO new migration; rate-limit config reuses `settings` table

**Phase 1b does NOT touch:**
- Node files, `bridge.py`, `watchdog.py`, `public/`, `personalities/`
- Phase 0/1a runtime adapters infrastructure (no new bus features)
- The remaining 5 adapters (hermes, cursor, codex, gemini, ollama — those are Phase 1c)
- Scheduler / cleanup (Phase 1c)
- Comm fabric (Phase 2)

---

## Setup

Before Task 1, branch off latest main:

```bash
cd /Users/joshuasack/Projects/visionary
git fetch origin
git checkout main
git pull --ff-only
git log --oneline -2  # should show b33091b at HEAD
git checkout -b feat/py-phase-1b-dispatch-and-failover
```

---

### Task 1: Cookbook (context window lookup)

**Files:**
- Create: `src/visionary/orchestration/__init__.py` (empty)
- Create: `src/visionary/orchestration/cookbook.py`
- Create: `tests/test_cookbook.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_cookbook.py
from visionary.orchestration.cookbook import context_window, list_models


def test_context_window_returns_int_for_known_model():
    assert context_window("claude", "claude-sonnet-4-6") > 0
    assert context_window("claude", "claude-opus-4-7") > 0


def test_context_window_returns_none_for_unknown():
    assert context_window("claude", "unknown-model") is None
    assert context_window("unknown-harness", "anything") is None


def test_list_models_for_harness_returns_iterable():
    assert "claude-sonnet-4-6" in list_models("claude")
    assert "claude-opus-4-7" in list_models("claude")
    assert list_models("unknown-harness") == []
```

- [ ] **Step 2: Run RED**

`.venv/bin/pytest tests/test_cookbook.py -v` → 3 import-error failures.

- [ ] **Step 3: Implement cookbook**

```python
# src/visionary/orchestration/cookbook.py
"""Cookbook — per-harness model catalog with context windows.

Tracks what Anthropic / OpenClaw / etc support. The numbers come from the
official model docs and are conservative defaults. Tweak if a model's window
changes upstream.
"""

# (harness, model) -> context window in tokens
_WINDOWS: dict[tuple[str, str], int] = {
    ("claude", "claude-opus-4-7"): 200_000,
    ("claude", "claude-sonnet-4-6"): 200_000,
    ("claude", "claude-haiku-4-5-20251001"): 200_000,
    ("openclaw", "claude-sonnet"): 200_000,
    ("openclaw", "claude-opus"): 200_000,
}


def context_window(harness: str, model: str) -> int | None:
    """Return the model's context window in tokens, or None if unknown."""
    return _WINDOWS.get((harness, model))


def list_models(harness: str) -> list[str]:
    """Return known model names for a harness (may be empty)."""
    return sorted({m for (h, m) in _WINDOWS if h == harness})
```

- [ ] **Step 4: GREEN** — `.venv/bin/pytest tests/test_cookbook.py -v` → 3/3 PASS.

- [ ] **Step 5: Lint + full suite** — `.venv/bin/ruff check src/visionary/orchestration/ tests/test_cookbook.py` clean; full suite 38 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/visionary/orchestration/__init__.py src/visionary/orchestration/cookbook.py tests/test_cookbook.py
git commit -m "feat(py): cookbook (context window per harness/model) — Phase 1b"
```

---

### Task 2: Guardrails (token budget + replay selection)

**Files:**
- Create: `src/visionary/orchestration/guardrails.py`
- Create: `tests/test_guardrails.py`

- [ ] **Step 1: Failing tests**

```python
# tests/test_guardrails.py
from visionary.orchestration.guardrails import (
    estimate_tokens,
    select_for_replay,
)


def test_estimate_tokens_returns_positive_int_for_text():
    assert estimate_tokens("hello world") > 0
    assert estimate_tokens("") == 0


def test_estimate_tokens_grows_with_text_size():
    short = estimate_tokens("hi")
    long = estimate_tokens("hi" * 1000)
    assert long > short


def test_select_for_replay_returns_empty_for_empty_input():
    assert select_for_replay([], ceiling=1000) == []


def test_select_for_replay_keeps_most_recent_within_budget():
    msgs = [
        {"role": "user", "content": "old long " * 100},
        {"role": "user", "content": "medium " * 20},
        {"role": "user", "content": "recent short"},
    ]
    selected = select_for_replay(msgs, ceiling=200)
    # Should include "recent short" (it's small + most recent)
    assert any("recent short" in m["content"] for m in selected)
    # The old long one should be excluded
    assert not any("old long" in m["content"] for m in selected[:1])


def test_select_for_replay_respects_ceiling():
    msgs = [{"role": "user", "content": "x" * 100} for _ in range(50)]
    selected = select_for_replay(msgs, ceiling=200)
    total = sum(estimate_tokens(m["content"]) for m in selected)
    assert total <= 200
```

- [ ] **Step 2: RED** → 5 import-error failures.

- [ ] **Step 3: Implement guardrails**

```python
# src/visionary/orchestration/guardrails.py
"""Guardrails — token budgeting + replay selection.

Mirror of the Node src/guardrails.js. Phase 1b uses estimate_tokens +
select_for_replay; jailbreak detection + canary tokens come in Phase 1c
when wired into the dispatch path.
"""

from typing import Any

# Conservative: ~4 chars/token for English text (Anthropic's published heuristic).
_CHARS_PER_TOKEN = 4


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    return max(1, len(text) // _CHARS_PER_TOKEN)


def select_for_replay(
    messages: list[dict[str, Any]],
    ceiling: int,
    most_recent_first: bool = True,
) -> list[dict[str, Any]]:
    """Pick the most recent messages that fit within the token ceiling.

    `messages` is a list of `{role, content}` dicts (or anything with `content`).
    Returns a NEW list in the original chronological order (oldest → newest)
    after dropping older ones that exceed the budget.
    """
    if not messages:
        return []
    # Walk from the end backwards, accumulating until budget exceeded
    selected: list[dict[str, Any]] = []
    budget = 0
    for msg in reversed(messages):
        cost = estimate_tokens(str(msg.get("content", "")))
        if budget + cost > ceiling:
            break
        selected.append(msg)
        budget += cost
    if most_recent_first:
        return list(reversed(selected))
    return selected
```

- [ ] **Step 4: GREEN** — 5/5 PASS.

- [ ] **Step 5: Lint + suite (43 PASS).**

- [ ] **Step 6: Commit**

```bash
git add src/visionary/orchestration/guardrails.py tests/test_guardrails.py
git commit -m "feat(py): guardrails (token estimate + replay selection) — Phase 1b"
```

---

### Task 3: Rate limiter (per-agent token bucket)

**Files:**
- Create: `src/visionary/orchestration/rate_limiter.py`
- Create: `tests/test_rate_limiter.py`
- Modify: `src/visionary/db/statements.py` — add `upsert_setting(key, value_json)`

- [ ] **Step 1: Failing tests**

```python
# tests/test_rate_limiter.py
import time
from pathlib import Path

import pytest

from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.orchestration.rate_limiter import RateLimiter


@pytest.fixture
def db(tmp_path: Path) -> Database:
    d = Database(str(tmp_path / "t.sqlite"))
    run_migrations(d)
    yield d
    d.close()


def test_default_capacity_allows_first_acquire(db):
    rl = RateLimiter(db)
    assert rl.acquire("scout") is True


def test_capacity_exhausts_after_n_acquires(db):
    rl = RateLimiter(db)
    rl.configure("scout", capacity=2, refill_per_second=0)
    assert rl.acquire("scout") is True
    assert rl.acquire("scout") is True
    assert rl.acquire("scout") is False


def test_refill_grants_tokens_over_time(db):
    rl = RateLimiter(db)
    rl.configure("scout", capacity=1, refill_per_second=10.0)
    assert rl.acquire("scout") is True
    assert rl.acquire("scout") is False
    time.sleep(0.2)  # 0.2 * 10 = 2 tokens worth, cap at 1
    assert rl.acquire("scout") is True


def test_status_returns_current_state(db):
    rl = RateLimiter(db)
    rl.configure("scout", capacity=5, refill_per_second=1.0)
    status = rl.status("scout")
    assert status["capacity"] == 5
    assert status["refill_per_second"] == 1.0
    assert 0 <= status["tokens"] <= 5


def test_configure_persists_via_settings(db):
    rl = RateLimiter(db)
    rl.configure("scout", capacity=7, refill_per_second=2.5)
    # New instance reads back from settings
    rl2 = RateLimiter(db)
    s = rl2.status("scout")
    assert s["capacity"] == 7
    assert s["refill_per_second"] == 2.5
```

- [ ] **Step 2: RED** → 5 import failures.

- [ ] **Step 3: Extend `statements.py`**

Add the upsert helper (no migration needed — settings is already an upsert-friendly key/value table):

```python
    # --- settings (upsert) ---
    def upsert_setting(self, key: str, value_json: str) -> None:
        self._db.execute(
            "INSERT INTO settings (key, value_json) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, "
            "updated_at = datetime('now')",
            [key, value_json],
        )
```

- [ ] **Step 4: Implement rate_limiter**

```python
# src/visionary/orchestration/rate_limiter.py
"""Per-agent token bucket throttle.

Config persists in `settings` under key `rate_limit:<agent_id>`. Counters
are in-memory (single-user, single-process). On `RateLimiter()` construction
we hydrate counter caps from settings; defaults if no setting.
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
        # Refresh in-memory bucket immediately
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
```

- [ ] **Step 5: GREEN** — 5/5 PASS.

- [ ] **Step 6: Lint + suite (48 PASS).**

- [ ] **Step 7: Commit**

```bash
git add src/visionary/orchestration/rate_limiter.py src/visionary/db/statements.py tests/test_rate_limiter.py
git commit -m "feat(py): rate limiter (per-agent token bucket) — Phase 1b"
```

---

### Task 4: Runtime adapter base + registry

**Files:**
- Create: `src/visionary/runtimes/__init__.py`
- Create: `src/visionary/runtimes/base.py`
- Create: `src/visionary/runtimes/registry.py`
- Create: `tests/test_runtimes_base.py`

- [ ] **Step 1: Failing tests**

```python
# tests/test_runtimes_base.py
import pytest

from visionary.runtimes.base import DispatchContext, DispatchResult, RuntimeAdapter
from visionary.runtimes.registry import Registry


class FakeAdapter:
    name = "fake"

    async def dispatch(self, ctx: DispatchContext) -> DispatchResult:
        return DispatchResult(ok=True, output="hi", error=None, exhausted=False)

    async def healthcheck(self) -> bool:
        return True


def test_registry_stores_and_returns_adapter():
    reg = Registry()
    reg.register(FakeAdapter())
    assert reg.get("fake").name == "fake"
    assert reg.has("fake")


def test_registry_returns_none_for_unknown():
    reg = Registry()
    assert reg.get("nope") is None
    assert reg.has("nope") is False


def test_dispatch_result_dataclass_round_trip():
    r = DispatchResult(ok=True, output="x", error=None, exhausted=False, harness_used="claude")
    assert r.ok is True
    assert r.output == "x"
    assert r.harness_used == "claude"
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement base + registry**

```python
# src/visionary/runtimes/__init__.py
from .base import DispatchContext, DispatchResult, RuntimeAdapter
from .registry import Registry

__all__ = ["DispatchContext", "DispatchResult", "RuntimeAdapter", "Registry"]
```

```python
# src/visionary/runtimes/base.py
"""Runtime adapter protocol + dataclasses.

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
    exhausted: bool = False  # rate-limited / quota exhausted (signals failover)
    harness_used: str | None = None
    duration_ms: int | None = None


class RuntimeAdapter(Protocol):
    name: str

    async def dispatch(self, ctx: DispatchContext) -> DispatchResult: ...
    async def healthcheck(self) -> bool: ...
```

```python
# src/visionary/runtimes/registry.py
from typing import Any


class Registry:
    def __init__(self) -> None:
        self._by_name: dict[str, Any] = {}

    def register(self, adapter: Any) -> None:
        self._by_name[adapter.name] = adapter

    def get(self, name: str) -> Any | None:
        return self._by_name.get(name)

    def has(self, name: str) -> bool:
        return name in self._by_name

    def names(self) -> list[str]:
        return sorted(self._by_name.keys())
```

- [ ] **Step 4: GREEN, lint, suite (51 PASS).**

- [ ] **Step 5: Commit**

```bash
git add src/visionary/runtimes/__init__.py src/visionary/runtimes/base.py src/visionary/runtimes/registry.py tests/test_runtimes_base.py
git commit -m "feat(py): runtime adapter Protocol + Registry — Phase 1b"
```

---

### Task 5: Claude adapter (`claude -p` CLI)

**Files:**
- Create: `src/visionary/runtimes/claude.py`
- Create: `tests/test_runtimes_claude.py`

The adapter shells out to the `claude` CLI. Tests use a stub script to avoid hitting the real CLI.

- [ ] **Step 1: Failing tests**

```python
# tests/test_runtimes_claude.py
import os
import stat
from pathlib import Path

import pytest

from visionary.runtimes.base import DispatchContext
from visionary.runtimes.claude import ClaudeAdapter


def _make_stub(tmp_path: Path, body: str) -> str:
    stub = tmp_path / "claude"
    stub.write_text(f"#!/bin/bash\n{body}\n")
    stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
    return str(stub)


async def test_dispatch_returns_output_on_success(tmp_path, monkeypatch):
    stub = _make_stub(tmp_path, 'echo "hello from claude"')
    monkeypatch.setenv("CLAUDE_BIN", stub)
    a = ClaudeAdapter()
    r = await a.dispatch(DispatchContext(agent_id="scout", prompt="hi"))
    assert r.ok is True
    assert "hello from claude" in r.output
    assert r.harness_used == "claude"


async def test_dispatch_detects_exhaustion_in_stderr(tmp_path, monkeypatch):
    stub = _make_stub(tmp_path, 'echo "rate limit exceeded" >&2; exit 1')
    monkeypatch.setenv("CLAUDE_BIN", stub)
    a = ClaudeAdapter()
    r = await a.dispatch(DispatchContext(agent_id="scout", prompt="hi"))
    assert r.ok is False
    assert r.exhausted is True


async def test_dispatch_returns_failure_on_other_error(tmp_path, monkeypatch):
    stub = _make_stub(tmp_path, 'echo "some random error" >&2; exit 2')
    monkeypatch.setenv("CLAUDE_BIN", stub)
    a = ClaudeAdapter()
    r = await a.dispatch(DispatchContext(agent_id="scout", prompt="hi"))
    assert r.ok is False
    assert r.exhausted is False


async def test_healthcheck_returns_true_for_present_binary(tmp_path, monkeypatch):
    stub = _make_stub(tmp_path, 'echo "claude 1.0"')
    monkeypatch.setenv("CLAUDE_BIN", stub)
    a = ClaudeAdapter()
    assert await a.healthcheck() is True


async def test_healthcheck_returns_false_for_missing_binary(monkeypatch):
    monkeypatch.setenv("CLAUDE_BIN", "/nonexistent/claude-bin")
    a = ClaudeAdapter()
    assert await a.healthcheck() is False
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement adapter**

```python
# src/visionary/runtimes/claude.py
"""Adapter for the headless `claude` CLI (Anthropic).

Reads the binary path from `CLAUDE_BIN` env var (default: `claude` on PATH).
"""

import asyncio
import os
import time
from pathlib import Path
from typing import ClassVar

from .base import DispatchContext, DispatchResult

# Substrings in stderr that mean the harness is rate-limited / out of quota.
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


class ClaudeAdapter:
    name: ClassVar[str] = "claude"

    def _bin(self) -> str:
        return os.environ.get("CLAUDE_BIN", "claude")

    async def dispatch(self, ctx: DispatchContext) -> DispatchResult:
        start = time.monotonic()
        args = [
            self._bin(),
            "-p", ctx.prompt,
            "--max-turns", str(ctx.max_turns),
        ]
        if ctx.allowed_tools:
            args.extend(["--allowedTools", ",".join(ctx.allowed_tools)])

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
                ok=False, output="", error=f"claude binary not found: {self._bin()}",
                exhausted=False, harness_used=self.name,
            )
        except asyncio.TimeoutError:
            return DispatchResult(
                ok=False, output="", error="claude dispatch timed out",
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
        path = self._bin()
        if Path(path).is_file() and os.access(path, os.X_OK):
            return True
        # Could be on PATH
        try:
            proc = await asyncio.create_subprocess_exec(
                path, "--version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await asyncio.wait_for(proc.communicate(), timeout=3)
            return proc.returncode == 0
        except (FileNotFoundError, asyncio.TimeoutError):
            return False
```

- [ ] **Step 4: GREEN, lint, suite (56 PASS).**

- [ ] **Step 5: Commit**

```bash
git add src/visionary/runtimes/claude.py tests/test_runtimes_claude.py
git commit -m "feat(py): claude CLI adapter (subprocess + exhaustion detection) — Phase 1b"
```

---

### Task 6: OpenClaw adapter

**Files:**
- Create: `src/visionary/runtimes/openclaw.py`
- Create: `tests/test_runtimes_openclaw.py`

Same pattern as Claude. Uses `OPENCLAW_BIN` env var. Tests use stub.

- [ ] **Step 1: Failing tests** (mirror Claude's, replace "claude" with "openclaw" everywhere; binary env var is `OPENCLAW_BIN`, adapter name is `"openclaw"`).

- [ ] **Step 2: Implement** (mirror Claude's, but the CLI args may differ — the OpenClaw CLI is invoked as `openclaw run --prompt <prompt>` historically; check `bridge.py` and `src/runtimes/openclaw.js` for the exact form. If unsure, use `openclaw run` + stdin for the prompt; for the stub we just print).

For the test stub, the dispatch just needs to produce stdout / non-zero stderr — adapt to whatever shell pattern works.

```python
# src/visionary/runtimes/openclaw.py
import asyncio
import os
import time
from pathlib import Path
from typing import ClassVar

from .base import DispatchContext, DispatchResult

_EXHAUSTION_MARKERS = (
    "rate limit", "rate-limit", "token limit", "quota",
    "weekly limit", "insufficient credit", "payment required",
    "429", "exceeded",
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
        path = self._bin()
        if Path(path).is_file() and os.access(path, os.X_OK):
            return True
        try:
            proc = await asyncio.create_subprocess_exec(
                path, "--version",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            await asyncio.wait_for(proc.communicate(), timeout=3)
            return proc.returncode == 0
        except (FileNotFoundError, asyncio.TimeoutError):
            return False
```

- [ ] **Step 3: GREEN (5/5), lint, suite (61 PASS).**

- [ ] **Step 4: Commit**

```bash
git add src/visionary/runtimes/openclaw.py tests/test_runtimes_openclaw.py
git commit -m "feat(py): openclaw CLI adapter — Phase 1b"
```

---

### Task 7: Failover engine

**Files:**
- Create: `src/visionary/runtimes/failover.py`
- Create: `tests/test_failover.py`
- Modify: `src/visionary/db/statements.py` — add `insert_agent_message`, `update_agent_harness`, `insert_agent_health_log`

- [ ] **Step 1: Failing tests**

```python
# tests/test_failover.py
from pathlib import Path

import pytest

from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.runtimes.base import DispatchContext, DispatchResult
from visionary.runtimes.failover import execute_with_failover
from visionary.runtimes.registry import Registry


class StubAdapter:
    def __init__(self, name: str, result: DispatchResult):
        self.name = name
        self._result = result
        self.calls = 0

    async def dispatch(self, ctx: DispatchContext) -> DispatchResult:
        self.calls += 1
        # Mutate harness_used on the way out, since the test creates a single
        # DispatchResult and reuses it
        r = self._result
        return DispatchResult(
            ok=r.ok, output=r.output, error=r.error, exhausted=r.exhausted,
            harness_used=self.name, duration_ms=r.duration_ms,
        )

    async def healthcheck(self) -> bool:
        return True


@pytest.fixture
def db(tmp_path: Path) -> Database:
    d = Database(str(tmp_path / "t.sqlite"))
    run_migrations(d)
    d.execute(
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, "
        "health_status, expected_activity_within_seconds) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["scout", "Scout", "researcher", "claude,openclaw", "claude", "ok", 3600],
    )
    yield d
    d.close()


async def test_success_on_first_harness(db):
    reg = Registry()
    reg.register(StubAdapter("claude", DispatchResult(
        ok=True, output="hi from claude", error=None, exhausted=False)))
    reg.register(StubAdapter("openclaw", DispatchResult(
        ok=True, output="should not run", error=None, exhausted=False)))

    ctx = DispatchContext(agent_id="scout", prompt="hello")
    r = await execute_with_failover(db, reg, "scout", ctx)
    assert r.ok is True
    assert "hi from claude" in r.output
    assert r.harness_used == "claude"


async def test_failover_to_next_on_exhaustion(db):
    claude_stub = StubAdapter("claude", DispatchResult(
        ok=False, output="", error="rate limit", exhausted=True))
    openclaw_stub = StubAdapter("openclaw", DispatchResult(
        ok=True, output="hi from openclaw", error=None, exhausted=False))
    reg = Registry()
    reg.register(claude_stub)
    reg.register(openclaw_stub)

    ctx = DispatchContext(agent_id="scout", prompt="hello")
    r = await execute_with_failover(db, reg, "scout", ctx)
    assert r.ok is True
    assert "openclaw" in r.output
    assert claude_stub.calls == 1
    assert openclaw_stub.calls == 1

    # The agent's current_harness should have advanced
    row = db.query_one("SELECT current_harness FROM agents WHERE id = ?", ["scout"])
    assert row["current_harness"] == "openclaw"


async def test_all_exhausted_returns_failure(db):
    reg = Registry()
    reg.register(StubAdapter("claude", DispatchResult(
        ok=False, output="", error="rate limit", exhausted=True)))
    reg.register(StubAdapter("openclaw", DispatchResult(
        ok=False, output="", error="quota exceeded", exhausted=True)))

    ctx = DispatchContext(agent_id="scout", prompt="hello")
    r = await execute_with_failover(db, reg, "scout", ctx)
    assert r.ok is False
    assert r.exhausted is True

    # Health status should be marked fail
    row = db.query_one("SELECT health_status FROM agents WHERE id = ?", ["scout"])
    assert row["health_status"] == "fail"


async def test_unknown_harness_is_skipped(db):
    """ENOENT-equivalent: an adapter not in the registry is skipped, not fail."""
    db.execute(
        "UPDATE agents SET harness_chain = ? WHERE id = ?",
        ["nonexistent,openclaw", "scout"],
    )
    db.execute(
        "UPDATE agents SET current_harness = ? WHERE id = ?",
        ["nonexistent", "scout"],
    )
    reg = Registry()
    reg.register(StubAdapter("openclaw", DispatchResult(
        ok=True, output="from openclaw", error=None, exhausted=False)))

    ctx = DispatchContext(agent_id="scout", prompt="hi")
    r = await execute_with_failover(db, reg, "scout", ctx)
    assert r.ok is True
    assert r.harness_used == "openclaw"


async def test_persists_turns_to_agent_messages(db):
    reg = Registry()
    reg.register(StubAdapter("claude", DispatchResult(
        ok=True, output="reply text", error=None, exhausted=False)))

    ctx = DispatchContext(agent_id="scout", prompt="my prompt")
    await execute_with_failover(db, reg, "scout", ctx)

    rows = db.query(
        "SELECT role, content FROM agent_messages WHERE agent_id = ? ORDER BY id",
        ["scout"],
    )
    assert len(rows) == 2
    assert rows[0]["role"] == "user"
    assert rows[0]["content"] == "my prompt"
    assert rows[1]["role"] == "assistant"
    assert rows[1]["content"] == "reply text"
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Extend statements**

```python
    # --- agent_messages ---
    def insert_agent_message(
        self, agent_id: str, role: str, content: str, harness: str | None = None
    ) -> None:
        self._db.execute(
            "INSERT INTO agent_messages (agent_id, role, content, harness) "
            "VALUES (?, ?, ?, ?)",
            [agent_id, role, content, harness],
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

    def insert_agent_health_log(
        self, agent_id: str, status: str, detail: str | None = None
    ) -> None:
        self._db.execute(
            "INSERT INTO agent_health_log (agent_id, status, detail) "
            "VALUES (?, ?, ?)",
            [agent_id, status, detail],
        )

    def list_recent_messages(
        self, agent_id: str, limit: int = 50
    ) -> list[dict]:
        return self._db.query(
            "SELECT role, content, harness, created_at FROM agent_messages "
            "WHERE agent_id = ? ORDER BY id DESC LIMIT ?",
            [agent_id, limit],
        )
```

(Check that the `agent_messages` table has columns `agent_id, role, content, harness, created_at` and `agent_health_log` has `agent_id, status, detail`. If columns differ, adjust accordingly.)

- [ ] **Step 4: Implement failover**

```python
# src/visionary/runtimes/failover.py
"""Failover engine — walks an agent's harness_chain on exhaustion.

Each agent has `harness_chain` (CSV) and `current_harness`. We start at
current_harness in the chain, try it, fail over on exhaustion to the next.
On success, persist user+assistant turns to agent_messages and update
current_harness if it changed.
"""

import logging
from typing import Sequence

from visionary.db.database import Database
from visionary.db.statements import Statements
from visionary.runtimes.base import DispatchContext, DispatchResult
from visionary.runtimes.registry import Registry

logger = logging.getLogger("visionary.runtimes.failover")


def _resolve_chain_from(chain: Sequence[str], current: str) -> list[str]:
    """Start the iteration at `current`, then walk forward."""
    chain = list(chain)
    if current in chain:
        i = chain.index(current)
        return chain[i:]
    return chain


async def execute_with_failover(
    db: Database,
    registry: Registry,
    agent_id: str,
    ctx: DispatchContext,
) -> DispatchResult:
    stmts = Statements(db)
    agent = stmts.get_agent_by_id(agent_id)
    if agent is None:
        return DispatchResult(
            ok=False, output="", error=f"agent not found: {agent_id}",
            exhausted=False,
        )

    chain_csv = agent.get("harness_chain") or ""
    chain = [s.strip() for s in chain_csv.split(",") if s.strip()]
    current = agent.get("current_harness") or (chain[0] if chain else "")
    sequence = _resolve_chain_from(chain, current)

    last_result: DispatchResult | None = None
    for harness in sequence:
        adapter = registry.get(harness)
        if adapter is None:
            logger.info("skipping unregistered harness '%s' for agent %s", harness, agent_id)
            continue

        result = await adapter.dispatch(ctx)
        last_result = result

        if result.ok:
            stmts.insert_agent_message(agent_id, "user", ctx.prompt, harness)
            stmts.insert_agent_message(agent_id, "assistant", result.output, harness)
            if current != harness:
                stmts.update_agent_harness(agent_id, harness)
            stmts.update_agent_health(agent_id, "ok")
            stmts.insert_agent_health_log(agent_id, "ok", harness)
            return result

        if result.exhausted:
            stmts.insert_agent_health_log(
                agent_id, "exhausted", f"{harness}: {result.error or ''}"
            )
            continue  # try next

        # Non-exhaustion failure → don't fail over, return this result
        stmts.insert_agent_health_log(
            agent_id, "fail", f"{harness}: {result.error or ''}"
        )
        return result

    stmts.update_agent_health(agent_id, "fail")
    if last_result is None:
        return DispatchResult(
            ok=False, output="", error="no harnesses available",
            exhausted=False,
        )
    return DispatchResult(
        ok=False, output="", error="all harnesses exhausted",
        exhausted=True, harness_used=last_result.harness_used,
    )
```

- [ ] **Step 5: GREEN (5/5), lint, suite (66 PASS).**

- [ ] **Step 6: Commit**

```bash
git add src/visionary/runtimes/failover.py src/visionary/db/statements.py tests/test_failover.py
git commit -m "feat(py): failover engine (walks harness_chain on exhaustion) — Phase 1b"
```

---

### Task 8: Dispatch + health + throttle routes + adapter wiring

**Files:**
- Create: `src/visionary/routes/dispatch.py`
- Create: `src/visionary/routes/health.py`
- Create: `src/visionary/routes/throttle.py`
- Create: `tests/test_routes_dispatch.py`
- Create: `tests/test_routes_health.py`
- Create: `tests/test_routes_throttle.py`
- Modify: `src/visionary/main.py` — register routers
- Modify: `src/visionary/lifecycle.py` — construct + stash registry + rate limiter

- [ ] **Step 1: Update `lifecycle.py`**

Inside the `try` block, after the EventBus construction, add:

```python
        from visionary.runtimes.registry import Registry
        from visionary.runtimes.claude import ClaudeAdapter
        from visionary.runtimes.openclaw import OpenClawAdapter
        from visionary.orchestration.rate_limiter import RateLimiter

        registry = Registry()
        registry.register(ClaudeAdapter())
        registry.register(OpenClawAdapter())
        app.state.registry = registry
        app.state.rate_limiter = RateLimiter(db)
```

- [ ] **Step 2: Failing tests** (one per route, plus one for throttle PUT)

```python
# tests/test_routes_dispatch.py
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.main import create_app


@pytest.fixture
def temp_env(tmp_path: Path, monkeypatch) -> Path:
    db_path = tmp_path / "t.sqlite"
    db = Database(str(db_path))
    run_migrations(db)
    db.execute(
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, "
        "health_status, expected_activity_within_seconds) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["scout", "Scout", "researcher", "claude,openclaw", "claude", "ok", 3600],
    )
    db.close()
    monkeypatch.setenv("VISIONARY_DB", str(db_path))
    pub = tmp_path / "public"; pub.mkdir(); (pub/"index.html").write_text("<html></html>")
    monkeypatch.setenv("VISIONARY_PUBLIC", str(pub))
    return tmp_path


def test_dispatch_with_no_real_cli_returns_5xx_or_failure(temp_env, monkeypatch):
    """Without a real claude binary, dispatch fails — but the route returns a 200 body
    describing the failure, not a 5xx (the dispatch path catches CLI-missing errors)."""
    monkeypatch.setenv("CLAUDE_BIN", "/nonexistent/claude")
    monkeypatch.setenv("OPENCLAW_BIN", "/nonexistent/openclaw")
    app = create_app()
    with TestClient(app) as client:
        r = client.post("/api/agents/scout/dispatch", json={"prompt": "hi"})
        # Real CLI missing → all harnesses skipped → 200 with ok=False
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is False


def test_dispatch_unknown_agent_returns_404(temp_env):
    app = create_app()
    with TestClient(app) as client:
        r = client.post("/api/agents/ghost/dispatch", json={"prompt": "hi"})
        assert r.status_code == 404
```

```python
# tests/test_routes_health.py
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.main import create_app


@pytest.fixture
def temp_env(tmp_path: Path, monkeypatch) -> None:
    db_path = tmp_path / "t.sqlite"
    db = Database(str(db_path))
    run_migrations(db)
    db.execute(
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, "
        "health_status, expected_activity_within_seconds) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["scout", "Scout", "researcher", "claude,openclaw", "claude", "ok", 3600],
    )
    db.close()
    monkeypatch.setenv("VISIONARY_DB", str(db_path))
    pub = tmp_path / "public"; pub.mkdir(); (pub/"index.html").write_text("<html></html>")
    monkeypatch.setenv("VISIONARY_PUBLIC", str(pub))


def test_health_check_with_no_real_cli(temp_env, monkeypatch):
    """No CLI installed → healthcheck false for all harnesses → returns body with ok=false."""
    monkeypatch.setenv("CLAUDE_BIN", "/nonexistent/claude")
    monkeypatch.setenv("OPENCLAW_BIN", "/nonexistent/openclaw")
    app = create_app()
    with TestClient(app) as client:
        r = client.post("/api/agents/scout/health-check")
        assert r.status_code == 200
        body = r.json()
        assert "ok" in body
        assert isinstance(body["ok"], bool)
```

```python
# tests/test_routes_throttle.py
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.main import create_app


@pytest.fixture
def temp_env(tmp_path: Path, monkeypatch) -> None:
    db_path = tmp_path / "t.sqlite"
    db = Database(str(db_path))
    run_migrations(db)
    db.execute(
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, "
        "health_status, expected_activity_within_seconds) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["scout", "Scout", "researcher", "claude,openclaw", "claude", "ok", 3600],
    )
    db.close()
    monkeypatch.setenv("VISIONARY_DB", str(db_path))
    pub = tmp_path / "public"; pub.mkdir(); (pub/"index.html").write_text("<html></html>")
    monkeypatch.setenv("VISIONARY_PUBLIC", str(pub))


def test_get_throttle_returns_defaults(temp_env):
    app = create_app()
    with TestClient(app) as client:
        r = client.get("/api/agents/scout/throttle")
        assert r.status_code == 200
        body = r.json()
        assert body["agent_id"] == "scout"
        assert body["throttle"]["capacity"] == 10
        assert body["throttle"]["refill_per_second"] == 1.0


def test_put_throttle_updates_config(temp_env):
    app = create_app()
    with TestClient(app) as client:
        r = client.put(
            "/api/agents/scout/throttle",
            json={"capacity": 25, "refill_per_second": 5.0},
        )
        assert r.status_code == 200

        r2 = client.get("/api/agents/scout/throttle")
        assert r2.json()["throttle"]["capacity"] == 25
        assert r2.json()["throttle"]["refill_per_second"] == 5.0
```

- [ ] **Step 3: RED.**

- [ ] **Step 4: Implement routes**

```python
# src/visionary/routes/dispatch.py
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from visionary.db.statements import Statements
from visionary.runtimes.base import DispatchContext
from visionary.runtimes.failover import execute_with_failover

router = APIRouter()


class DispatchRequest(BaseModel):
    prompt: str
    model: str | None = None
    max_turns: int = 20
    allowed_tools: list[str] = []
    timeout_seconds: int = 300


@router.post("/api/agents/{agent_id}/dispatch")
async def dispatch_agent(agent_id: str, req: DispatchRequest, request: Request) -> dict:
    db = request.app.state.db
    registry = request.app.state.registry
    rate_limiter = request.app.state.rate_limiter

    if Statements(db).get_agent_by_id(agent_id) is None:
        raise HTTPException(status_code=404, detail=f"agent not found: {agent_id}")

    if not rate_limiter.acquire(agent_id):
        return {"ok": False, "error": "rate-limited", "status": "rate-limited"}

    ctx = DispatchContext(
        agent_id=agent_id, prompt=req.prompt, model=req.model,
        max_turns=req.max_turns, allowed_tools=req.allowed_tools,
        timeout_seconds=req.timeout_seconds,
    )
    result = await execute_with_failover(db, registry, agent_id, ctx)
    return {
        "ok": result.ok,
        "output": result.output,
        "error": result.error,
        "harness_used": result.harness_used,
        "duration_ms": result.duration_ms,
        "exhausted": result.exhausted,
    }
```

```python
# src/visionary/routes/health.py
from fastapi import APIRouter, HTTPException, Request

from visionary.db.statements import Statements

router = APIRouter()


@router.post("/api/agents/{agent_id}/health-check")
async def health_check(agent_id: str, request: Request) -> dict:
    db = request.app.state.db
    registry = request.app.state.registry
    stmts = Statements(db)

    agent = stmts.get_agent_by_id(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"agent not found: {agent_id}")

    chain = [s.strip() for s in (agent.get("harness_chain") or "").split(",") if s.strip()]
    results: dict[str, bool] = {}
    any_ok = False
    for harness in chain:
        adapter = registry.get(harness)
        if adapter is None:
            results[harness] = False
            continue
        ok = await adapter.healthcheck()
        results[harness] = bool(ok)
        any_ok = any_ok or ok

    status = "ok" if any_ok else "fail"
    stmts.update_agent_health(agent_id, status)
    stmts.insert_agent_health_log(agent_id, status, ",".join(f"{k}={v}" for k, v in results.items()))

    return {"ok": any_ok, "status": status, "harnesses": results}
```

```python
# src/visionary/routes/throttle.py
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

router = APIRouter()


class ThrottleConfig(BaseModel):
    capacity: int = Field(ge=1)
    refill_per_second: float = Field(ge=0)


@router.get("/api/agents/{agent_id}/throttle")
async def get_throttle(agent_id: str, request: Request) -> dict:
    rl = request.app.state.rate_limiter
    return {"agent_id": agent_id, "throttle": rl.status(agent_id)}


@router.put("/api/agents/{agent_id}/throttle")
async def put_throttle(agent_id: str, cfg: ThrottleConfig, request: Request) -> dict:
    rl = request.app.state.rate_limiter
    rl.configure(agent_id, cfg.capacity, cfg.refill_per_second)
    return {"agent_id": agent_id, "throttle": rl.status(agent_id)}
```

- [ ] **Step 5: Register routers in `main.py`** (alongside existing includes, before StaticFiles).

```python
    from visionary.routes import dispatch as dispatch_routes
    from visionary.routes import health as health_routes
    from visionary.routes import throttle as throttle_routes
    app.include_router(dispatch_routes.router)
    app.include_router(health_routes.router)
    app.include_router(throttle_routes.router)
```

- [ ] **Step 6: GREEN, lint, full suite (target ~71 tests PASS).**

- [ ] **Step 7: Side-by-side sanity check (manual)**

Start uvicorn on 3344. Verify:
- `curl -X POST http://127.0.0.1:3344/api/agents/coder/dispatch -d '{"prompt":"hi"}' -H content-type:application/json` returns a JSON body (likely with `ok: false` if claude/openclaw aren't installed on PATH — that's fine, we're confirming the route works)
- `curl -X POST http://127.0.0.1:3344/api/agents/coder/health-check` returns health results
- `curl http://127.0.0.1:3344/api/agents/coder/throttle` returns defaults
- `curl -X PUT http://127.0.0.1:3344/api/agents/coder/throttle -d '{"capacity":15,"refill_per_second":2}' -H content-type:application/json` updates

Confirm Node on 3333 still works. Stop uvicorn.

- [ ] **Step 8: Final verify** — pytest, ruff, npm.

- [ ] **Step 9: Commit**

```bash
git add src/visionary/routes/dispatch.py src/visionary/routes/health.py src/visionary/routes/throttle.py src/visionary/main.py src/visionary/lifecycle.py tests/test_routes_dispatch.py tests/test_routes_health.py tests/test_routes_throttle.py
git commit -m "feat(py): dispatch + health-check + throttle routes (failover wired) — Phase 1b"
```

---

### Task 9: Push + open PR

- [ ] **Step 1: Push** — `git push -u origin feat/py-phase-1b-dispatch-and-failover`

- [ ] **Step 2: Open PR**

```bash
gh pr create --base main --title "feat(py): Phase 1b — Dispatch + failover engine (Python backend migration)" --body "$(cat <<'EOF'
## Summary

Phase 1b of the Python backend migration. Implements the harness-switching dispatch path: rate limiter, guardrails (token estimate + replay selection), cookbook (context windows), 2 runtime adapters (claude, openclaw), failover engine, and HTTP routes for dispatch / health-check / throttle.

**This delivers "ability to call and switch agent harnesses" from the session goal.**

## What this lands

- `orchestration/cookbook.py` — per-harness model context windows
- `orchestration/guardrails.py` — `estimate_tokens`, `select_for_replay`
- `orchestration/rate_limiter.py` — per-agent token bucket, persisted in `settings`
- `runtimes/base.py` + `runtimes/registry.py` — `RuntimeAdapter` Protocol + Registry
- `runtimes/claude.py` — `claude -p` CLI adapter (subprocess + exhaustion detection)
- `runtimes/openclaw.py` — `openclaw run` CLI adapter
- `runtimes/failover.py` — walks `harness_chain` on exhaustion, persists turns to `agent_messages`, updates `current_harness` + `health_status`
- `routes/dispatch.py` — `POST /api/agents/{id}/dispatch` (rate-limit gate + failover)
- `routes/health.py` — `POST /api/agents/{id}/health-check`
- `routes/throttle.py` — `GET/PUT /api/agents/{id}/throttle`

## Architecture notes

- All SQL still in `db/statements.py` (added 4 new methods)
- No new pip deps; CLIs invoked via `asyncio.create_subprocess_exec`
- Rate-limit config persists in `settings` (no migration 8 — keeps schema stable)
- `app.state.registry` + `app.state.rate_limiter` constructed in lifespan

## Out of scope (Phase 1c)

- 5 remaining adapters (hermes, cursor, codex, gemini, ollama)
- Scheduler tick + cleanup tick (in-process tasks)
- Deep research route
- Token-aware replay (failover doesn't currently inject prior context)

## Out of scope (Phase 2)

- Comm fabric (mailbox + pubsub + direct + blackboard)

## Test plan

- [x] pytest all green
- [x] ruff clean
- [x] npm verify 22/22
- [x] Side-by-side: dispatch + health-check + throttle routes respond; Node on 3333 unaffected
EOF
)"
```

- [ ] **Step 3: Note PR URL.**

---

## Phase 1b acceptance criteria

- [ ] pytest all green (target ~71 tests)
- [ ] ruff clean
- [ ] uvicorn starts cleanly on 3344
- [ ] `/api/agents/{id}/dispatch` (POST) returns JSON body with ok/output/harness_used
- [ ] `/api/agents/{id}/health-check` (POST) returns harness map
- [ ] `/api/agents/{id}/throttle` (GET/PUT) read+write works
- [ ] Node on 3333 unaffected
- [ ] npm verify still 22/22
- [ ] PR opened

When Phase 1b lands, Phase 1c (remaining adapters + scheduler + cleanup + deep research) is planned next.
