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
        "VALUES ('scout','Scout','r','claude','claude','ok',3600)"
    )
    db.close()
    monkeypatch.setenv("VISIONARY_DB", str(tmp_path / "t.sqlite"))
    pub = tmp_path / "public"
    pub.mkdir()
    (pub / "index.html").write_text("<html></html>")
    monkeypatch.setenv("VISIONARY_PUBLIC", str(pub))


def test_post_then_get_mailbox(temp_env):
    app = create_app()
    with TestClient(app) as client:
        r = client.post(
            "/api/agents/scout/mailbox",
            json={"subject": "hi", "body": {"text": "do X"}, "sender": "broker"},
        )
        assert r.status_code == 200
        mid = r.json()["id"]
        r2 = client.get("/api/agents/scout/mailbox")
        assert r2.status_code == 200
        msgs = r2.json()["messages"]
        assert len(msgs) == 1
        assert msgs[0]["id"] == mid


def test_ack_marks_processed(temp_env):
    app = create_app()
    with TestClient(app) as client:
        r = client.post(
            "/api/agents/scout/mailbox",
            json={"subject": "x", "body": {}},
        )
        mid = r.json()["id"]
        client.post(f"/api/agents/scout/mailbox/{mid}/ack")
        pending = client.get("/api/agents/scout/mailbox").json()["messages"]
        assert pending == []
