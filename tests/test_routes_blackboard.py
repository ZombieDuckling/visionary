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
    db.close()
    monkeypatch.setenv("VISIONARY_DB", str(tmp_path / "t.sqlite"))
    pub = tmp_path / "public"
    pub.mkdir()
    (pub / "index.html").write_text("<html></html>")
    monkeypatch.setenv("VISIONARY_PUBLIC", str(pub))


def test_put_get_delete_blackboard(temp_env):
    app = create_app()
    with TestClient(app) as client:
        r = client.put(
            "/api/blackboard/topic.x",
            json={"value": {"n": 1}, "by": "ceo"},
        )
        assert r.status_code == 200
        assert r.json()["version"] == 1
        r2 = client.get("/api/blackboard/topic.x")
        assert r2.json()["value"] == {"n": 1}
        client.delete("/api/blackboard/topic.x")
        assert client.get("/api/blackboard/topic.x").status_code == 404


def test_blackboard_get_unknown_returns_404(temp_env):
    app = create_app()
    with TestClient(app) as client:
        r = client.get("/api/blackboard/nope")
        assert r.status_code == 404
