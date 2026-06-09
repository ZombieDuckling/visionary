import json

from fastapi import APIRouter, HTTPException, Request

from visionary.db.statements import Statements

router = APIRouter()


@router.get("/api/settings/watchdog")
async def get_watchdog_settings(request: Request) -> dict:
    stmts = Statements(request.app.state.db)
    row = stmts.get_setting("watchdog")
    if row is None:
        raise HTTPException(status_code=404, detail="watchdog settings missing")
    try:
        parsed = json.loads(row["value_json"])
    except (json.JSONDecodeError, KeyError) as e:
        raise HTTPException(status_code=500, detail=f"watchdog settings malformed: {e}") from e
    return {"watchdog": parsed}
