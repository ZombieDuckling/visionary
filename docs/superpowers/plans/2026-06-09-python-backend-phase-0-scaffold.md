# Python Backend Migration — Phase 0: Scaffold

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a FastAPI app that serves the existing `public/` frontend and runs migrations 1-7 against the existing `visionary.sqlite`. Runs side-by-side on port **3344** with the live Node server on **3333**.

**Architecture:** Python 3.12 + venv. FastAPI + uvicorn + pydantic v2. Stdlib `sqlite3` wrapped by a thin `Database` class. Migration runner mirrors `db.js`'s append-only array pattern. Phase 0 ships NO routes beyond `/` (StaticFiles) and `/healthz` — SSE, WebSocket, comm fabric, orchestration, all real API routes are later phases.

**Tech Stack:** Python 3.12, FastAPI ≥0.115, uvicorn[standard] ≥0.32, pydantic ≥2.9, sse-starlette ≥2.1, websockets ≥13, pytest ≥8, pytest-asyncio ≥0.24, httpx ≥0.27, ruff ≥0.6.

**Spec reference:** `docs/superpowers/specs/2026-06-09-python-backend-design.md` §7 Phase 0.

---

## File structure (Phase 0)

**Files created:**
- `pyproject.toml`
- `src/visionary/__init__.py`
- `src/visionary/settings.py`
- `src/visionary/main.py`
- `src/visionary/lifecycle.py`
- `src/visionary/db/__init__.py`
- `src/visionary/db/database.py`
- `src/visionary/db/migrations.py`
- `tests/__init__.py`
- `tests/test_db.py`
- `tests/test_migrations.py`
- `tests/test_settings.py`
- `tests/test_app.py`

**Files modified:**
- `.gitignore` — append Python entries

**Phase 0 deliberately does NOT touch:**
- Node source (`server.js`, `db.js`, `sse.js`, `src/runtimes/*.js`, `src/*.js`, `bridge.py`, `watchdog.py`)
- The live `visionary.sqlite` (tests use temp DBs only)
- The frontend (`public/*`)
- Future modules: `src/visionary/routes/`, `comm/`, `runtimes/`, `orchestration/`, `sse/`

---

## Setup

All Python commands assume the project venv: `.venv/bin/python`, `.venv/bin/pytest`, `.venv/bin/uvicorn`, `.venv/bin/ruff`. You may `source .venv/bin/activate` once per shell instead.

Working directory for every task: the repo root (`/Users/joshuasack/Projects/visionary`).

**Before Task 1**, create a feature branch off the latest `main`:

```bash
git fetch origin
git checkout main
git pull --ff-only
git checkout -b feat/py-phase-0-scaffold
```

---

### Task 1: Scaffold `pyproject.toml` + venv + gitignore

**Files:**
- Create: `pyproject.toml`
- Modify: `.gitignore`

- [ ] **Step 1: Write `pyproject.toml`**

```toml
[project]
name = "visionary"
version = "2.1.0-dev"
description = "Visionary Mission Control — local-first multi-agent dashboard"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.32",
  "pydantic>=2.9",
  "sse-starlette>=2.1",
  "websockets>=13",
]

[project.optional-dependencies]
dev = [
  "pytest>=8",
  "pytest-asyncio>=0.24",
  "httpx>=0.27",
  "ruff>=0.6",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/visionary"]

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "ASYNC"]
ignore = ["E501"]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
addopts = "-v --tb=short"
```

- [ ] **Step 2: Append Python entries to `.gitignore`**

Append these lines to the existing `.gitignore` (do not overwrite):

```
# Python
.venv/
__pycache__/
*.pyc
.pytest_cache/
.ruff_cache/
*.egg-info/
dist/
build/
```

- [ ] **Step 3: Create venv and install dev deps**

Run:
```bash
python3.12 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install -e ".[dev]"
```

Expected: all installs succeed. `.venv/bin/uvicorn`, `.venv/bin/pytest`, `.venv/bin/ruff` exist.

- [ ] **Step 4: Verify tooling**

Run: `.venv/bin/ruff check . ; .venv/bin/pytest --collect-only`

Expected: ruff has nothing to lint (no `.py` files yet) and prints "All checks passed!" or similar. pytest exits with "no tests collected" (exit 5 is fine).

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml .gitignore
git commit -m "feat(py): scaffold pyproject.toml + venv (Phase 0)"
```

---

### Task 2: `Database` connection wrapper (TDD)

**Files:**
- Create: `src/visionary/__init__.py`
- Create: `src/visionary/db/__init__.py`
- Create: `src/visionary/db/database.py`
- Create: `tests/__init__.py`
- Create: `tests/test_db.py`

- [ ] **Step 1: Create empty package init files**

```python
# src/visionary/__init__.py
__version__ = "2.1.0-dev"
```

```python
# src/visionary/db/__init__.py
from .database import Database

__all__ = ["Database"]
```

```python
# tests/__init__.py
```

- [ ] **Step 2: Write the failing tests**

```python
# tests/test_db.py
from pathlib import Path

import pytest

from visionary.db import Database


def test_database_executes_and_queries(tmp_path: Path):
    db = Database(str(tmp_path / "test.sqlite"))
    db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)")
    db.execute("INSERT INTO t (name) VALUES (?)", ["alice"])
    db.execute("INSERT INTO t (name) VALUES (?)", ["bob"])
    rows = db.query("SELECT * FROM t ORDER BY id")
    assert rows == [{"id": 1, "name": "alice"}, {"id": 2, "name": "bob"}]
    one = db.query_one("SELECT * FROM t WHERE name = ?", ["alice"])
    assert one == {"id": 1, "name": "alice"}
    missing = db.query_one("SELECT * FROM t WHERE name = ?", ["nope"])
    assert missing is None
    db.close()


def test_database_transaction_commits(tmp_path: Path):
    db = Database(str(tmp_path / "test.sqlite"))
    db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)")
    with db.transaction():
        db.execute("INSERT INTO t (name) VALUES (?)", ["committed"])
    rows = db.query("SELECT name FROM t")
    assert [r["name"] for r in rows] == ["committed"]
    db.close()


def test_database_transaction_rolls_back_on_error(tmp_path: Path):
    db = Database(str(tmp_path / "test.sqlite"))
    db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)")
    with pytest.raises(ValueError):
        with db.transaction():
            db.execute("INSERT INTO t (name) VALUES (?)", ["rolledback"])
            raise ValueError("boom")
    rows = db.query("SELECT name FROM t")
    assert rows == []
    db.close()


def test_database_enables_wal_mode(tmp_path: Path):
    db = Database(str(tmp_path / "test.sqlite"))
    mode = db.query_one("PRAGMA journal_mode")
    assert mode is not None
    assert mode.get("journal_mode") == "wal"
    db.close()
```

- [ ] **Step 3: Run tests, expect failure**

Run: `.venv/bin/pytest tests/test_db.py -v`

Expected: 4 failures with `ModuleNotFoundError: No module named 'visionary.db.database'`.

- [ ] **Step 4: Implement `Database`**

```python
# src/visionary/db/database.py
import sqlite3
from contextlib import contextmanager
from typing import Any, Iterator


class Database:
    """Thin wrapper around sqlite3 with WAL, queries, and a transaction context.

    Mirrors better-sqlite3's discipline on the Node side: prepared SQL only,
    no inline SQL in route handlers (prepared statements will live in
    statements.py in Phase 1).
    """

    def __init__(self, path: str):
        self._conn = sqlite3.connect(path, isolation_level=None, timeout=5)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode = WAL")
        self._conn.execute("PRAGMA busy_timeout = 5000")
        self._conn.execute("PRAGMA foreign_keys = ON")

    def execute(self, sql: str, params: list[Any] | None = None) -> sqlite3.Cursor:
        return self._conn.execute(sql, params or [])

    def executescript(self, sql: str) -> None:
        self._conn.executescript(sql)

    def query(self, sql: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
        cursor = self._conn.execute(sql, params or [])
        return [dict(row) for row in cursor.fetchall()]

    def query_one(self, sql: str, params: list[Any] | None = None) -> dict[str, Any] | None:
        cursor = self._conn.execute(sql, params or [])
        row = cursor.fetchone()
        return dict(row) if row else None

    @contextmanager
    def transaction(self) -> Iterator[None]:
        self._conn.execute("BEGIN")
        try:
            yield
            self._conn.execute("COMMIT")
        except Exception:
            self._conn.execute("ROLLBACK")
            raise

    def close(self) -> None:
        self._conn.close()
```

- [ ] **Step 5: Run tests, verify pass**

Run: `.venv/bin/pytest tests/test_db.py -v`

Expected: 4/4 PASS.

- [ ] **Step 6: Lint check**

Run: `.venv/bin/ruff check src/visionary/`

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/visionary/__init__.py src/visionary/db/__init__.py src/visionary/db/database.py tests/__init__.py tests/test_db.py
git commit -m "feat(py): Database wrapper (sqlite3 + WAL + transactions) — Phase 0"
```

---

### Task 3: Migration runner + port migrations 1-7

**Files:**
- Create: `src/visionary/db/migrations.py`
- Create: `tests/test_migrations.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_migrations.py
from pathlib import Path

from visionary.db import Database
from visionary.db.migrations import MIGRATIONS, run_migrations


def test_run_migrations_against_empty_db_applies_all(tmp_path: Path):
    db = Database(str(tmp_path / "test.sqlite"))
    final = run_migrations(db)
    assert final == len(MIGRATIONS)
    version_row = db.query_one("SELECT version FROM schema_version")
    assert version_row is not None
    assert version_row["version"] == len(MIGRATIONS)
    db.close()


def test_run_migrations_is_idempotent(tmp_path: Path):
    db = Database(str(tmp_path / "test.sqlite"))
    first = run_migrations(db)
    second = run_migrations(db)
    assert first == second
    db.close()


def test_run_migrations_creates_core_tables(tmp_path: Path):
    db = Database(str(tmp_path / "test.sqlite"))
    run_migrations(db)
    tables = {
        row["name"]
        for row in db.query(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        )
    }
    expected = {
        "schema_version",
        "projects",
        "tasks",
        "agent_runs",
        "notifications",
        "activity_log",
        "interview_sessions",
        "agents",
        "settings",
        "spaces",
        "agent_messages",
        "agent_health_log",
        "schedules",
    }
    missing = expected - tables
    assert not missing, f"Missing tables: {missing}"
    db.close()


def test_migration_7_adds_last_nudge_at_column(tmp_path: Path):
    db = Database(str(tmp_path / "test.sqlite"))
    run_migrations(db)
    cols = {row["name"] for row in db.query("PRAGMA table_info(agents)")}
    assert "last_nudge_at" in cols
    db.close()


def test_migration_7_seeds_watchdog_settings(tmp_path: Path):
    db = Database(str(tmp_path / "test.sqlite"))
    run_migrations(db)
    row = db.query_one("SELECT value_json FROM settings WHERE key = ?", ["watchdog"])
    assert row is not None
```

- [ ] **Step 2: Run tests, expect failure**

Run: `.venv/bin/pytest tests/test_migrations.py -v`

Expected: 5 failures with `ModuleNotFoundError: No module named 'visionary.db.migrations'`.

- [ ] **Step 3: Implement the migration runner skeleton**

```python
# src/visionary/db/migrations.py
"""Migration runner — mirrors db.js's append-only array.

Add new migrations at the END of MIGRATIONS. Never edit or reorder a shipped
entry.
"""

from visionary.db.database import Database

# Each entry is (version: int, sql: str).
# IMPORTANT: append-only. Do not edit or reorder shipped entries.
# Migrations 1-7 are transcribed from db.js — see Step 4.
MIGRATIONS: list[tuple[int, str]] = [
    # (1, "..."),
    # (2, "..."),
    # ...
    # (7, "ALTER TABLE agents ADD COLUMN last_nudge_at TEXT; INSERT OR IGNORE INTO settings ..."),
]


_BOOTSTRAP = """
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);
INSERT OR IGNORE INTO schema_version (version) VALUES (0);
"""


def _current_version(db: Database) -> int:
    db.executescript(_BOOTSTRAP)
    row = db.query_one("SELECT version FROM schema_version LIMIT 1")
    return row["version"] if row else 0


def _set_version(db: Database, version: int) -> None:
    db.execute("UPDATE schema_version SET version = ?", [version])


def run_migrations(db: Database) -> int:
    """Apply unapplied migrations in order. Returns the final schema version."""
    current = _current_version(db)
    for version, sql in MIGRATIONS:
        if version <= current:
            continue
        with db.transaction():
            db.executescript(sql)
            _set_version(db, version)
        current = version
    return current
```

- [ ] **Step 4: Transcribe migrations 1-7 from `db.js`**

Open `db.js` at the repo root. Locate its `migrations` array (look for `const migrations = [` or similar). For each entry, copy the SQL body verbatim into a new tuple in the Python `MIGRATIONS` list, keeping the same version number and order.

Notes for the transcription:
- Some migrations may use JS template literals (backticks) — flatten each into a single Python triple-quoted string.
- Multi-statement migrations are fine — `executescript` runs them all.
- Preserve the SQL exactly: column names, constraints, defaults, indexes.
- Migration 7 includes both `ALTER TABLE agents ADD COLUMN last_nudge_at TEXT` AND an `INSERT OR IGNORE INTO settings ... 'watchdog' ...` statement — keep both in the same SQL string.

The final `MIGRATIONS` list should contain exactly **7** entries: `(1, ...)`, `(2, ...)`, …, `(7, ...)`.

- [ ] **Step 5: Run tests, verify pass**

Run: `.venv/bin/pytest tests/test_migrations.py -v`

Expected: 5/5 PASS.

If a table-missing test fails, the corresponding migration wasn't transcribed yet. If `migration_7_adds_last_nudge_at_column` fails, migration 7's ALTER wasn't included.

- [ ] **Step 6: Cross-check against the live DB (read-only)**

This proves the ported migrations are equivalent to the deployed ones.

Run:
```bash
cp visionary.sqlite /tmp/visionary-port-check.sqlite
.venv/bin/python -c "
from visionary.db import Database
from visionary.db.migrations import run_migrations
db = Database('/tmp/visionary-port-check.sqlite')
final = run_migrations(db)
print(f'Schema version after port-run: {final}')
db.close()
"
sqlite3 /tmp/visionary-port-check.sqlite 'SELECT version FROM schema_version;'
rm /tmp/visionary-port-check.sqlite
```

Expected: `Schema version after port-run: 7`, and the SQLite query also returns `7`. No migrations were re-applied (the live DB is already at 7).

- [ ] **Step 7: Lint check**

Run: `.venv/bin/ruff check src/visionary/db/migrations.py`

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/visionary/db/migrations.py tests/test_migrations.py
git commit -m "feat(py): migration runner + port migrations 1-7 — Phase 0"
```

---

### Task 4: `Settings` (env-driven config)

**Files:**
- Create: `src/visionary/settings.py`
- Create: `tests/test_settings.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_settings.py
from visionary.settings import Settings


def test_settings_uses_defaults(monkeypatch):
    monkeypatch.delenv("VISIONARY_DB", raising=False)
    monkeypatch.delenv("VISIONARY_PORT", raising=False)
    monkeypatch.delenv("VISIONARY_HOST", raising=False)
    monkeypatch.delenv("VISIONARY_PUBLIC", raising=False)
    s = Settings()
    assert s.host == "127.0.0.1"
    assert s.port == 3344
    assert s.db_path.endswith("visionary.sqlite")
    assert s.public_dir.endswith("public")


def test_settings_reads_env_overrides(monkeypatch):
    monkeypatch.setenv("VISIONARY_DB", "/tmp/elsewhere.sqlite")
    monkeypatch.setenv("VISIONARY_PORT", "9999")
    monkeypatch.setenv("VISIONARY_HOST", "0.0.0.0")
    monkeypatch.setenv("VISIONARY_PUBLIC", "/tmp/pub")
    s = Settings()
    assert s.db_path == "/tmp/elsewhere.sqlite"
    assert s.port == 9999
    assert s.host == "0.0.0.0"
    assert s.public_dir == "/tmp/pub"
```

- [ ] **Step 2: Run tests, expect failure**

Run: `.venv/bin/pytest tests/test_settings.py -v`

Expected: 2 failures with `ModuleNotFoundError: No module named 'visionary.settings'`.

- [ ] **Step 3: Implement `Settings`**

```python
# src/visionary/settings.py
import os
from pathlib import Path


class Settings:
    """Env-driven config. Re-reads env on every construction so tests using
    monkeypatch see the right values."""

    def __init__(self) -> None:
        repo_root = Path(__file__).resolve().parent.parent.parent
        self.host: str = os.environ.get("VISIONARY_HOST", "127.0.0.1")
        self.port: int = int(os.environ.get("VISIONARY_PORT", "3344"))
        self.db_path: str = os.environ.get(
            "VISIONARY_DB", str(repo_root / "visionary.sqlite")
        )
        self.public_dir: str = os.environ.get(
            "VISIONARY_PUBLIC", str(repo_root / "public")
        )
```

- [ ] **Step 4: Run tests, verify pass**

Run: `.venv/bin/pytest tests/test_settings.py -v`

Expected: 2/2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/visionary/settings.py tests/test_settings.py
git commit -m "feat(py): Settings (env-driven config) — Phase 0"
```

---

### Task 5: FastAPI app skeleton + `StaticFiles` + `/healthz`

**Files:**
- Create: `src/visionary/lifecycle.py`
- Create: `src/visionary/main.py`
- Create: `tests/test_app.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_app.py
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.main import create_app


@pytest.fixture
def temp_db(tmp_path: Path) -> str:
    db_path = tmp_path / "test.sqlite"
    db = Database(str(db_path))
    run_migrations(db)
    db.close()
    return str(db_path)


@pytest.fixture
def temp_public(tmp_path: Path) -> str:
    pub = tmp_path / "public"
    pub.mkdir()
    (pub / "index.html").write_text("<html><title>hello</title></html>")
    (pub / "app.js").write_text("// stub asset")
    return str(pub)


async def test_healthz_returns_ok(temp_db: str, temp_public: str, monkeypatch):
    monkeypatch.setenv("VISIONARY_DB", temp_db)
    monkeypatch.setenv("VISIONARY_PUBLIC", temp_public)
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/healthz")
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert body["schema_version"] == 7


async def test_index_html_is_served_at_root(temp_db: str, temp_public: str, monkeypatch):
    monkeypatch.setenv("VISIONARY_DB", temp_db)
    monkeypatch.setenv("VISIONARY_PUBLIC", temp_public)
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/")
        assert r.status_code == 200
        assert "hello" in r.text
        assert "text/html" in r.headers["content-type"]


async def test_static_assets_are_served(temp_db: str, temp_public: str, monkeypatch):
    monkeypatch.setenv("VISIONARY_DB", temp_db)
    monkeypatch.setenv("VISIONARY_PUBLIC", temp_public)
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/app.js")
        assert r.status_code == 200
        assert "stub asset" in r.text
```

- [ ] **Step 2: Run tests, expect failure**

Run: `.venv/bin/pytest tests/test_app.py -v`

Expected: 3 failures with `ModuleNotFoundError: No module named 'visionary.main'`.

- [ ] **Step 3: Implement `lifecycle.py`**

```python
# src/visionary/lifecycle.py
import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.settings import Settings

logger = logging.getLogger("visionary.lifecycle")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Phase 0 lifespan: open DB, run migrations, stash on app.state.

    Phase 3 will add watchdog + bridge + scheduler asyncio tasks here.
    """
    settings = Settings()
    db = Database(settings.db_path)
    version = run_migrations(db)
    logger.info("DB ready at %s (schema_version=%d)", settings.db_path, version)
    app.state.settings = settings
    app.state.db = db
    app.state.schema_version = version

    try:
        yield
    finally:
        db.close()
        logger.info("DB closed")
```

- [ ] **Step 4: Implement `main.py`**

```python
# src/visionary/main.py
import logging

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles

from visionary.lifecycle import lifespan
from visionary.settings import Settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger("visionary.main")


def create_app() -> FastAPI:
    settings = Settings()
    app = FastAPI(
        title="Visionary Mission Control",
        version="2.1.0-dev",
        lifespan=lifespan,
    )

    @app.get("/healthz")
    async def healthz(request: Request) -> dict:
        return {
            "ok": True,
            "schema_version": request.app.state.schema_version,
            "host": settings.host,
            "port": settings.port,
        }

    # StaticFiles mount must be LAST — it matches every unmatched path.
    app.mount("/", StaticFiles(directory=settings.public_dir, html=True), name="public")

    return app


app = create_app()
```

- [ ] **Step 5: Run tests, verify pass**

Run: `.venv/bin/pytest tests/test_app.py -v`

Expected: 3/3 PASS.

- [ ] **Step 6: Run the full Phase 0 test suite**

Run: `.venv/bin/pytest -v`

Expected: **14 tests pass** (Database 4 + migrations 5 + settings 2 + app 3).

- [ ] **Step 7: Lint check**

Run: `.venv/bin/ruff check src/ tests/`

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/visionary/main.py src/visionary/lifecycle.py tests/test_app.py
git commit -m "feat(py): FastAPI app + StaticFiles + /healthz — Phase 0"
```

---

### Task 6: Side-by-side sanity check (manual)

This task has no code changes — it verifies the Python backend runs alongside the live Node backend without conflict.

- [ ] **Step 1: Confirm the live Node server is still on port 3333**

Run: `curl -s http://127.0.0.1:3333/api/org | python -m json.tool | head -10`

Expected: org-chart JSON with `ceo` / `reports` structure. Live Node + watchdog are healthy.

- [ ] **Step 2: Start the Python app on port 3344**

In a new terminal:
```bash
cd /Users/joshuasack/Projects/visionary
.venv/bin/uvicorn visionary.main:app --host 127.0.0.1 --port 3344 --log-level info
```

Expected: log includes "Application startup complete." and "Uvicorn running on http://127.0.0.1:3344".

- [ ] **Step 3: Verify `/healthz` responds with schema_version=7**

In another terminal:
```bash
curl -s http://127.0.0.1:3344/healthz | python -m json.tool
```

Expected:
```json
{
  "ok": true,
  "schema_version": 7,
  "host": "127.0.0.1",
  "port": 3344
}
```

- [ ] **Step 4: Verify the existing UI is served from the Python server**

Run:
```bash
curl -s -I http://127.0.0.1:3344/ | head -2
curl -s http://127.0.0.1:3344/app.js | head -3
```

Expected: `HTTP/1.1 200 OK` and `Content-Type: text/html` for `/`. `/app.js` returns the actual frontend bundle content.

- [ ] **Step 5: Confirm Node side is unaffected**

Run: `curl -s http://127.0.0.1:3333/api/org | python -m json.tool | head -10`

Expected: same org-chart JSON as Step 1.

- [ ] **Step 6: Stop the Python app**

Ctrl+C in the uvicorn terminal. Node + watchdog continue running.

- [ ] **Step 7: No commit (manual checkpoint)**

Nothing to commit. Record the checkpoint result in the PR description.

---

### Task 7: README note + final verification

**Files:**
- Modify: `README.md` (if present) or `HANDOFF.md`

- [ ] **Step 1: Append a Python backend status note**

If `README.md` exists at the repo root, append:

```markdown
## Python backend migration (in progress)

Phase 0 (scaffold) complete. See `docs/superpowers/specs/2026-06-09-python-backend-design.md` for design and `docs/superpowers/plans/` for phase plans.

To run the Python backend side-by-side with the Node server on port 3333:

    python3.12 -m venv .venv
    .venv/bin/pip install -e ".[dev]"
    .venv/bin/uvicorn visionary.main:app --port 3344

To run tests:

    .venv/bin/pytest
```

If `README.md` does not exist, append the same content to `HANDOFF.md` under a new `## Python backend migration` section. If neither exists, create `README.md` with just that content.

- [ ] **Step 2: Full Python test suite**

Run: `.venv/bin/pytest -v`

Expected: 14 tests PASS.

- [ ] **Step 3: Final lint**

Run: `.venv/bin/ruff check src/ tests/`

Expected: clean.

- [ ] **Step 4: Confirm Node side still green**

Run: `npm run verify`

Expected: 22/22 PASS. Phase 0 should not have touched anything Node depends on.

- [ ] **Step 5: Commit (only if README/HANDOFF was modified)**

```bash
git add README.md HANDOFF.md  # whichever was modified
git commit -m "docs: Phase 0 (Python scaffold) status note"
```

---

### Task 8: Push branch + open PR

- [ ] **Step 1: Push the branch**

Run:
```bash
git push -u origin feat/py-phase-0-scaffold
```

Expected: branch is pushed; tracking is set up.

- [ ] **Step 2: Open the PR**

Run:
```bash
gh pr create --base main \
  --title "feat(py): Phase 0 — FastAPI scaffold (Python backend migration)" \
  --body "$(cat <<'EOF'
## Summary

Phase 0 of the Python backend migration. See `docs/superpowers/specs/2026-06-09-python-backend-design.md` for the design and `docs/superpowers/plans/2026-06-09-python-backend-phase-0-scaffold.md` for the plan.

What this lands:
- `pyproject.toml` + venv setup
- `Database` wrapper (sqlite3 + WAL + transactions)
- Migration runner + migrations 1-7 ported from `db.js`
- `Settings` (env-driven config)
- FastAPI app + `StaticFiles` mount + `/healthz`
- Runs side-by-side on port 3344 (Node stays on 3333)

## Out of scope (later phases)

- All real API routes (Phase 1)
- Runtime adapters (Phase 1)
- SSE, WebSocket, comm fabric (Phase 2)
- Watchdog + scheduler as in-process tasks (Phase 3)
- Node retirement (Phase 4)

## Test plan

- [x] `.venv/bin/pytest -v` — 14 tests pass
- [x] `.venv/bin/ruff check src/ tests/` — clean
- [x] `npm run verify` — 22/22 still green (no Node files touched)
- [x] Side-by-side: `uvicorn` on 3344 serves `public/index.html`; Node on 3333 unaffected
EOF
)"
```

Expected: PR URL is printed.

- [ ] **Step 3: Record the PR URL** in your notes for follow-up review.

---

## Phase 0 acceptance criteria

When all of these are checked, Phase 0 ships:

- [ ] `python3.12 -m venv .venv` + `pip install -e ".[dev]"` succeeds
- [ ] `.venv/bin/pytest -v` runs **14 tests, all PASS**
- [ ] `.venv/bin/ruff check src/ tests/` is **clean**
- [ ] `uvicorn visionary.main:app --port 3344` starts cleanly
- [ ] `curl http://127.0.0.1:3344/healthz` returns `schema_version: 7`
- [ ] `curl http://127.0.0.1:3344/` serves `public/index.html`
- [ ] Live Node server (3333) and watchdog continue running unaffected
- [ ] `npm run verify` is **still 22/22 green**
- [ ] PR opened against `main`

When Phase 0 lands on `main`, the Phase 1 plan (port all routes + runtime adapters + scheduler + cleanup + rate limiter + guardrails + cookbook) is written next.
