from pathlib import Path

import pytest
from fastapi.testclient import TestClient

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


def test_healthz_returns_ok(temp_db: str, temp_public: str, monkeypatch):
    monkeypatch.setenv("VISIONARY_DB", temp_db)
    monkeypatch.setenv("VISIONARY_PUBLIC", temp_public)
    app = create_app()
    with TestClient(app) as client:
        r = client.get("/healthz")
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert body["schema_version"] == 8


def test_index_html_is_served_at_root(temp_db: str, temp_public: str, monkeypatch):
    monkeypatch.setenv("VISIONARY_DB", temp_db)
    monkeypatch.setenv("VISIONARY_PUBLIC", temp_public)
    app = create_app()
    with TestClient(app) as client:
        r = client.get("/")
        assert r.status_code == 200
        assert "hello" in r.text
        assert "text/html" in r.headers["content-type"]


def test_static_assets_are_served(temp_db: str, temp_public: str, monkeypatch):
    monkeypatch.setenv("VISIONARY_DB", temp_db)
    monkeypatch.setenv("VISIONARY_PUBLIC", temp_public)
    app = create_app()
    with TestClient(app) as client:
        r = client.get("/app.js")
        assert r.status_code == 200
        assert "stub asset" in r.text
