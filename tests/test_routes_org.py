import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.main import create_app


@pytest.fixture
def temp_env(tmp_path: Path, monkeypatch) -> Path:
    db_path = tmp_path / "test.sqlite"
    db = Database(str(db_path))
    run_migrations(db)
    db.execute(
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, "
        "health_status, expected_activity_within_seconds) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["jarvis", "Jarvis", "ceo", "claude,openclaw", "claude", "ok", 7200],
    )
    db.execute(
        "INSERT INTO agents (id, name, role, harness_chain, current_harness, "
        "health_status, expected_activity_within_seconds) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["scout", "Scout", "researcher", "openclaw,claude", "openclaw", "ok", 3600],
    )
    db.close()

    org_dir = tmp_path / "personalities"
    org_dir.mkdir()
    (org_dir / "org-chart.json").write_text(json.dumps({
        "ceo": {
            "id": "jarvis",
            "name": "Jarvis",
            "role": "ceo",
            "reports": [
                {"id": "scout", "name": "Scout", "role": "researcher", "reports": []}
            ],
        }
    }))

    monkeypatch.setenv("VISIONARY_DB", str(db_path))
    monkeypatch.setenv("VISIONARY_ORG_CHART", str(org_dir / "org-chart.json"))
    pub = tmp_path / "public"
    pub.mkdir()
    (pub / "index.html").write_text("<html></html>")
    monkeypatch.setenv("VISIONARY_PUBLIC", str(pub))
    return tmp_path


def test_get_org_returns_tree(temp_env: Path):
    app = create_app()
    with TestClient(app) as client:
        r = client.get("/api/org")
        assert r.status_code == 200
        body = r.json()
        assert "ceo" in body
        assert body["ceo"]["id"] == "jarvis"
        assert body["ceo"]["current_harness"] == "claude"
        assert body["ceo"]["health_status"] == "ok"
        assert len(body["ceo"]["reports"]) == 1
        assert body["ceo"]["reports"][0]["id"] == "scout"
        assert body["ceo"]["reports"][0]["current_harness"] == "openclaw"


def test_get_org_missing_agent_row_keeps_node_with_defaults(temp_env: Path):
    """If an org-chart entry has no matching DB row, the node still renders
    with defaults (empty current_harness, 'unknown' health) — don't 500."""
    chart_path = Path(temp_env / "personalities" / "org-chart.json")
    chart = json.loads(chart_path.read_text())
    chart["ceo"]["reports"].append({"id": "ghost", "name": "Ghost", "role": "spy", "reports": []})
    chart_path.write_text(json.dumps(chart))

    app = create_app()
    with TestClient(app) as client:
        r = client.get("/api/org")
        assert r.status_code == 200
        body = r.json()
        ghost = next(n for n in body["ceo"]["reports"] if n["id"] == "ghost")
        assert ghost["current_harness"] == ""
        assert ghost["health_status"] == "unknown"
