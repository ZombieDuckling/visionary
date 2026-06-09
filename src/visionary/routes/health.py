from fastapi import APIRouter, HTTPException, Request

from visionary.db.statements import Statements

router = APIRouter()


@router.post("/api/agents/{agent_id}/health-check")
async def health_check(agent_id: str, request: Request) -> dict:
    db = request.app.state.db
    registry = request.app.state.registry
    stmts = Statements(db)

    agent = stmts.get_agent_by_id(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"agent not found: {agent_id}")

    chain = [s.strip() for s in (agent.get("harness_chain") or "").split(",") if s.strip()]
    results: dict[str, bool] = {}
    any_ok = False
    for harness in chain:
        adapter = registry.get(harness)
        if adapter is None:
            results[harness] = False
            continue
        ok = await adapter.healthcheck()
        results[harness] = bool(ok)
        any_ok = any_ok or ok

    status = "ok" if any_ok else "fail"
    stmts.update_agent_health(agent_id, status)
    detail = ",".join(f"{k}={v}" for k, v in results.items())
    stmts.insert_agent_health_log(agent_id, status, detail)

    return {"ok": any_ok, "status": status, "harnesses": results}
