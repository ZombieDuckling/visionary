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
    db.close()
    monkeypatch.setenv("VISIONARY_DB", str(tmp_path / "test.sqlite"))
    pub = tmp_path / "public"
    pub.mkdir()
    (pub / "index.html").write_text("<html></html>")
    monkeypatch.setenv("VISIONARY_PUBLIC", str(pub))


def test_get_watchdog_settings_returns_defaults(temp_env):
    """Migration 7 seeded {auto_nudge_enabled: false, nudge_cooldown_seconds: 900}."""
    app = create_app()
    with TestClient(app) as client:
        r = client.get("/api/settings/watchdog")
        assert r.status_code == 200
        body = r.json()
        assert body["watchdog"]["auto_nudge_enabled"] is False
        assert body["watchdog"]["nudge_cooldown_seconds"] == 900
