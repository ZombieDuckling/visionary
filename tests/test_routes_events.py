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


def test_event_bus_is_on_app_state(temp_env):
    """Lifespan must populate app.state.event_bus."""
    app = create_app()
    with TestClient(app) as client:
        # Trigger any request to confirm lifespan ran
        r = client.get("/healthz")
        assert r.status_code == 200
        assert hasattr(app.state, "event_bus")
        assert app.state.event_bus.subscriber_count() == 0


def test_events_endpoint_route_exists(temp_env):
    """Smoke-test that /api/events route is registered in the app.

    We check FastAPI's route table directly rather than making an HTTP request,
    because SSE streaming responses never terminate and hang synchronous clients.
    Actual SSE event delivery is tested in test_sse.py against the bus directly.
    """
    app = create_app()
    routes = {getattr(r, "path", None) for r in app.routes}
    assert "/api/events" in routes
