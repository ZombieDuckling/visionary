import json

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()


class SendRequest(BaseModel):
    subject: str
    body: dict
    sender: str | None = None
    priority: int = 0
    thread_id: str | None = None
    reply_to: int | None = None


@router.post("/api/agents/{agent_id}/mailbox")
async def send_message(agent_id: str, req: SendRequest, request: Request) -> dict:
    comm = request.app.state.comm
    mid = comm.mail(
        to=agent_id, sender=req.sender, subject=req.subject, body=req.body,
        priority=req.priority, thread_id=req.thread_id, reply_to=req.reply_to,
    )
    return {"id": mid}


@router.get("/api/agents/{agent_id}/mailbox")
async def list_pending(agent_id: str, request: Request) -> dict:
    comm = request.app.state.comm
    msgs = comm.mailbox.list(to=agent_id)
    for m in msgs:
        try:
            m["body"] = json.loads(m["body_json"])
        except Exception:
            m["body"] = m["body_json"]
    return {"messages": msgs}


@router.post("/api/agents/{agent_id}/mailbox/{mid}/ack")
async def ack_message(agent_id: str, mid: int, request: Request) -> dict:
    comm = request.app.state.comm
    msg = comm.mailbox.get(mid)
    if msg is None or msg["to_agent_id"] != agent_id:
        raise HTTPException(status_code=404, detail="message not found")
    comm.mailbox.mark_processed(mid)
    return {"ok": True, "id": mid}
