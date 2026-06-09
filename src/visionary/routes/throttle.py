from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

router = APIRouter()


class ThrottleConfig(BaseModel):
    capacity: int = Field(ge=1)
    refill_per_second: float = Field(ge=0)


@router.get("/api/agents/{agent_id}/throttle")
async def get_throttle(agent_id: str, request: Request) -> dict:
    rl = request.app.state.rate_limiter
    return {"agent_id": agent_id, "throttle": rl.status(agent_id)}


@router.put("/api/agents/{agent_id}/throttle")
async def put_throttle(agent_id: str, cfg: ThrottleConfig, request: Request) -> dict:
    rl = request.app.state.rate_limiter
    rl.configure(agent_id, cfg.capacity, cfg.refill_per_second)
    return {"agent_id": agent_id, "throttle": rl.status(agent_id)}
