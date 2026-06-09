"""Topic pub/sub with MQTT-style wildcards.

Port of bridge.py's PubSub class. In-memory only. Each subscribe() call
returns an async generator that yields matching messages.
"""

import asyncio
from datetime import datetime, timezone
from typing import AsyncIterator

_MAX_HISTORY = 100


def topic_matches(subscription: str, topic: str) -> bool:
    """MQTT wildcards: `+` matches one level, `#` matches rest."""
    if subscription == topic or subscription == "#":
        return True
    sub_parts = subscription.split(".")
    topic_parts = topic.split(".")
    for i, sp in enumerate(sub_parts):
        if sp == "#":
            return True
        if i >= len(topic_parts):
            return False
        if sp == "+":
            continue
        if sp != topic_parts[i]:
            return False
    return len(sub_parts) == len(topic_parts)


class PubSub:
    def __init__(self) -> None:
        self._subscribers: list[tuple[list[str], asyncio.Queue[dict]]] = []
        self._history: dict[str, list[dict]] = {}
        self._lock = asyncio.Lock()

    async def subscribe(self, topics: list[str]) -> AsyncIterator[dict]:
        q: asyncio.Queue[dict] = asyncio.Queue(maxsize=1024)
        async with self._lock:
            self._subscribers.append((list(topics), q))
        try:
            while True:
                msg = await q.get()
                yield msg
        finally:
            async with self._lock:
                self._subscribers = [
                    (s, qq) for (s, qq) in self._subscribers if qq is not q
                ]

    async def publish(self, topic: str, payload: dict, sender: str = "system") -> None:
        msg = {
            "type": "message",
            "topic": topic,
            "payload": payload,
            "from": sender,
            "ts": datetime.now(timezone.utc).isoformat(),
        }
        self._history.setdefault(topic, []).append(msg)
        if len(self._history[topic]) > _MAX_HISTORY:
            self._history[topic] = self._history[topic][-_MAX_HISTORY:]

        async with self._lock:
            targets = [
                (subs, q) for (subs, q) in self._subscribers
                if any(topic_matches(s, topic) for s in subs)
            ]
        for _subs, q in targets:
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                pass

    def history(self, topic_filter: str, limit: int = 20) -> list[dict]:
        results: list[dict] = []
        for t, msgs in self._history.items():
            if topic_matches(topic_filter, t):
                results.extend(msgs)
        results.sort(key=lambda m: m.get("ts", ""), reverse=True)
        return results[:limit]

    def subscriber_count(self) -> int:
        return len(self._subscribers)
