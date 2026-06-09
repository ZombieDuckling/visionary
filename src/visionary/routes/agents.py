from fastapi import APIRouter, HTTPException, Request

from visionary.db.statements import Statements

router = APIRouter()


@router.get("/api/agents")
async def list_agents(request: Request) -> dict:
    stmts = Statements(request.app.state.db)
    return {"agents": stmts.list_agents()}


@router.get("/api/agents/{agent_id}")
async def get_agent(agent_id: str, request: Request) -> dict:
    stmts = Statements(request.app.state.db)
    row = stmts.get_agent_by_id(agent_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"agent not found: {agent_id}")
    return row
