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
