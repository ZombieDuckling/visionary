"""GET /api/org — read org chart from JSON + DB runtime state."""

import json
from typing import Any

import anyio
from fastapi import APIRouter, Request

from visionary.db.statements import Statements

router = APIRouter()


def _merge(node: dict[str, Any], by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Combine an org-chart.json node with its runtime row, recursing into reports."""
    row = by_id.get(node["id"], {})
    return {
        "id": node["id"],
        "name": node.get("name") or row.get("name") or node["id"],
        "role": node.get("role") or row.get("role") or "",
        "current_harness": row.get("current_harness") or "",
        "health_status": row.get("health_status") or "unknown",
        "last_activity_at": row.get("last_activity_at"),
        "last_nudge_at": row.get("last_nudge_at"),
        "reports": [_merge(r, by_id) for r in node.get("reports", [])],
    }


@router.get("/api/org")
async def get_org(request: Request) -> dict:
    settings = request.app.state.settings
    db = request.app.state.db
    stmts = Statements(db)
    rows = stmts.list_agents()
    by_id = {r["id"]: r for r in rows}

    raw = await anyio.Path(settings.org_chart_path).read_text()
    chart = json.loads(raw)

    return {"ceo": _merge(chart["ceo"], by_id)}
