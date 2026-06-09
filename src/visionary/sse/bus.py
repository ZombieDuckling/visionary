"""In-process SSE event bus.

Async pub/sub. Each subscriber gets its own queue. Closed automatically when
the consumer stops iterating.

Phase 1a uses this for `/api/events` (read-only stream). Phase 2 will wire
the comm fabric (mailbox/pubsub/direct/blackboard) into the same bus.
"""

import asyncio
import logging
from typing import AsyncIterator

logger = logging.getLogger("visionary.sse.bus")


class EventBus:
    def __init__(self, max_queue_size: int = 1024) -> None:
        self._subscribers: set[asyncio.Queue[dict]] = set()
        self._max_queue_size = max_queue_size
        self._lock = asyncio.Lock()

    async def subscribe(self) -> AsyncIterator[dict]:
        """Async generator that yields events until the consumer stops."""
        queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=self._max_queue_size)
        async with self._lock:
            self._subscribers.add(queue)
        try:
            while True:
                event = await queue.get()
                yield event
        finally:
            async with self._lock:
                self._subscribers.discard(queue)

    async def publish(self, event: dict) -> None:
        """Fan an event out to every current subscriber.

        Drops events to full queues (slow consumer) and logs the drop.
        """
        async with self._lock:
            targets = list(self._subscribers)
        for q in targets:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning(
                    "SSE subscriber queue full (%d items); dropping event %s",
                    q.qsize(),
                    event.get("type"),
                )

    def subscriber_count(self) -> int:
        return len(self._subscribers)
