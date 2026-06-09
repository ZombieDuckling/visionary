from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from visionary.db.statements import Statements
from visionary.runtimes.base import DispatchContext
from visionary.runtimes.failover import execute_with_failover

router = APIRouter()


class DispatchRequest(BaseModel):
    prompt: str
    model: str | None = None
    max_turns: int = 20
    allowed_tools: list[str] = []
    timeout_seconds: int = 300


@router.post("/api/agents/{agent_id}/dispatch")
async def dispatch_agent(agent_id: str, req: DispatchRequest, request: Request) -> dict:
    db = request.app.state.db
    registry = request.app.state.registry
    rate_limiter = request.app.state.rate_limiter

    if Statements(db).get_agent_by_id(agent_id) is None:
        raise HTTPException(status_code=404, detail=f"agent not found: {agent_id}")

    if not rate_limiter.acquire(agent_id):
        return {"ok": False, "error": "rate-limited", "status": "rate-limited"}

    ctx = DispatchContext(
        agent_id=agent_id, prompt=req.prompt, model=req.model,
        max_turns=req.max_turns, allowed_tools=req.allowed_tools,
        timeout_seconds=req.timeout_seconds,
    )
    result = await execute_with_failover(db, registry, agent_id, ctx)
    return {
        "ok": result.ok,
        "output": result.output,
        "error": result.error,
        "harness_used": result.harness_used,
        "duration_ms": result.duration_ms,
        "exhausted": result.exhausted,
    }
