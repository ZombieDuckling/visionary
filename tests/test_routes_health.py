from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.main import create_app


@pytest.fixture
def temp_env(tmp_path: Path, monkeypatch):
    db = Database(str(tmp_path / "t.sqlite"))
    run_migrations(db)
    db.execute(
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, "
        "health_status, expected_activity_within_seconds) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["scout", "Scout", "researcher", "claude,openclaw", "claude", "ok", 3600],
    )
    db.close()
    monkeypatch.setenv("VISIONARY_DB", str(tmp_path / "t.sqlite"))
    pub = tmp_path / "public"
    pub.mkdir()
    (pub / "index.html").write_text("<html></html>")
    monkeypatch.setenv("VISIONARY_PUBLIC", str(pub))


def test_health_check_with_no_real_cli(temp_env, monkeypatch):
    monkeypatch.setenv("CLAUDE_BIN", "/nonexistent/claude")
    monkeypatch.setenv("OPENCLAW_BIN", "/nonexistent/openclaw")
    app = create_app()
    with TestClient(app) as client:
        r = client.post("/api/agents/scout/health-check")
        assert r.status_code == 200
        body = r.json()
        assert "ok" in body
        assert isinstance(body["ok"], bool)
