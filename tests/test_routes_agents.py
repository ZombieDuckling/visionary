from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.main import create_app


@pytest.fixture
def temp_env(tmp_path: Path, monkeypatch) -> None:
    db_path = tmp_path / "test.sqlite"
    db = Database(str(db_path))
    run_migrations(db)
    db.execute(
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, "
        "health_status, expected_activity_within_seconds) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["scout", "Scout", "researcher", "openclaw,claude", "openclaw", "ok", 3600],
    )
    db.execute(
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, "
        "health_status, expected_activity_within_seconds) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["broker", "Broker", "analyst", "claude,openclaw", "claude", "ok", 3600],
    )
    db.close()
    monkeypatch.setenv("VISIONARY_DB", str(db_path))
    pub = tmp_path / "public"
    pub.mkdir()
    (pub / "index.html").write_text("<html></html>")
    monkeypatch.setenv("VISIONARY_PUBLIC", str(pub))


def test_list_agents_returns_array(temp_env):
    app = create_app()
    with TestClient(app) as client:
        r = client.get("/api/agents")
        assert r.status_code == 200
        body = r.json()
        assert "agents" in body
        ids = {a["id"] for a in body["agents"]}
        assert ids == {"scout", "broker"}


def test_get_agent_returns_single(temp_env):
    app = create_app()
    with TestClient(app) as client:
        r = client.get("/api/agents/scout")
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == "scout"
        assert body["current_harness"] == "openclaw"


def test_get_agent_not_found_returns_404(temp_env):
    app = create_app()
    with TestClient(app) as client:
        r = client.get("/api/agents/ghost")
        assert r.status_code == 404
