from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.main import create_app


@pytest.fixture
def temp_env(tmp_path: Path, monkeypatch) -> None:
    db = Database(str(tmp_path / "test.sqlite"))
    run_migrations(db)
    db.execute(
        "INSERT INTO schedules (id, name, cron, agent_id, prompt, enabled) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        [1, "Morning brief", "0 8 * * *", "scout", "research overnight", 1],
    )
    db.close()
    monkeypatch.setenv("VISIONARY_DB", str(tmp_path / "test.sqlite"))
    pub = tmp_path / "public"
    pub.mkdir()
    (pub / "index.html").write_text("<html></html>")
    monkeypatch.setenv("VISIONARY_PUBLIC", str(pub))


def test_list_schedules_returns_seeded(temp_env):
    app = create_app()
    with TestClient(app) as client:
        r = client.get("/api/schedules")
        assert r.status_code == 200
        body = r.json()
        assert "schedules" in body
        assert len(body["schedules"]) == 1
        assert body["schedules"][0]["name"] == "Morning brief"
        assert body["schedules"][0]["enabled"] in (1, True)
