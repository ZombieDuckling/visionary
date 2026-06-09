from fastapi import APIRouter, Request

from visionary.db.statements import Statements

router = APIRouter()


@router.get("/api/schedules")
async def list_schedules(request: Request) -> dict:
    stmts = Statements(request.app.state.db)
    return {"schedules": stmts.list_schedules()}
