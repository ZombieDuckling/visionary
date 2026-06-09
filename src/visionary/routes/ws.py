"""WebSocket /ws/agent — port of bridge.py's WS protocol.

Protocol messages (JSON):
- {"type": "subscribe",   "topics": ["agent.chat.+"]}
- {"type": "unsubscribe", "topics": ["agent.chat.+"]}
- {"type": "publish",     "topic": "...", "payload": {...}, "from": "..."}
- {"type": "presence",    "agent_id": "scout", "status": "working"}
- {"type": "ping"} / {"type": "pong"}
- {"type": "history",     "topic": "agent.#", "limit": 20}
"""

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger("visionary.routes.ws")
router = APIRouter()


@router.websocket("/ws/agent")
async def ws_agent(websocket: WebSocket) -> None:
    await websocket.accept()
    comm = websocket.app.state.comm
    pubsub = comm.pubsub

    subscriptions: list[str] = []
    consumer_task: asyncio.Task | None = None

    async def fan_in() -> None:
        if not subscriptions:
            return
        try:
            async for msg in pubsub.subscribe(subscriptions):
                await websocket.send_text(json.dumps(msg, default=str))
        except Exception:
            logger.exception("ws consumer error")

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_text(
                    json.dumps({"type": "error", "error": "invalid JSON"})
                )
                continue

            t = data.get("type")
            if t == "subscribe":
                topics = data.get("topics") or []
                subscriptions = list({*subscriptions, *topics})
                if consumer_task is None or consumer_task.done():
                    consumer_task = asyncio.create_task(fan_in())
            elif t == "unsubscribe":
                drop = set(data.get("topics") or [])
                subscriptions = [s for s in subscriptions if s not in drop]
            elif t == "publish":
                topic = data.get("topic", "")
                payload = data.get("payload") or {}
                sender = data.get("from") or "anonymous"
                if topic:
                    await comm.publish(topic, payload, sender=sender)
            elif t == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
            elif t == "history":
                topic_filter = data.get("topic", "#")
                limit = min(int(data.get("limit", 20)), 100)
                hist = pubsub.history(topic_filter, limit)
                await websocket.send_text(
                    json.dumps({"type": "history", "messages": hist}, default=str)
                )
            else:
                await websocket.send_text(
                    json.dumps({"type": "error", "error": f"unknown type: {t}"})
                )
    except WebSocketDisconnect:
        pass
    finally:
        if consumer_task is not None:
            consumer_task.cancel()
