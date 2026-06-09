"""GET /api/events — SSE stream of in-process events.

The frontend (`public/app.js`) connects via `new EventSource('/api/events')`.
Events come from `app.state.event_bus` (an `EventBus` instance set up in lifespan).
"""

import json
import logging

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

logger = logging.getLogger("visionary.routes.events")
router = APIRouter()


@router.get("/api/events")
async def stream_events(request: Request):
    bus = request.app.state.event_bus

    async def gen():
        async for event in bus.subscribe():
            if await request.is_disconnected():
                return
            yield {
                "event": event.get("type", "message"),
                "data": json.dumps(event.get("payload", {})),
            }

    return EventSourceResponse(gen())
