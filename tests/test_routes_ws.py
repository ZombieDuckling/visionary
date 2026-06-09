from pathlib import Path

import pytest

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


def test_ws_route_registered(temp_env):
    """Verify /ws/agent is in the app's routes. Live WS testing via TestClient
    is fiddly; that integration belongs in Phase 4 cutover sanity check."""
    app = create_app()
    paths = {r.path for r in app.routes if hasattr(r, "path")}
    assert "/ws/agent" in paths
