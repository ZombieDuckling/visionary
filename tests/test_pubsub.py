import asyncio

import pytest

from visionary.comm.pubsub import PubSub, topic_matches


@pytest.mark.parametrize("sub,topic,expected", [
    ("agent.chat.scout", "agent.chat.scout", True),
    ("agent.chat.+", "agent.chat.scout", True),
    ("agent.chat.+", "agent.chat.scout.deep", False),
    ("agent.chat.#", "agent.chat.scout.deep", True),
    ("agent.#", "agent.chat.scout", True),
    ("#", "anything.here", True),
    ("agent.chat.scout", "agent.chat.broker", False),
])
def test_topic_matches(sub, topic, expected):
    assert topic_matches(sub, topic) is expected


async def test_publish_delivers_to_matching_subscriber():
    ps = PubSub()
    received: list[dict] = []

    async def consume():
        async for msg in ps.subscribe(["agent.chat.+"]):
            received.append(msg)
            if len(received) >= 1:
                return

    task = asyncio.create_task(consume())
    await asyncio.sleep(0)
    await ps.publish("agent.chat.scout", {"text": "hi"}, sender="broker")
    await task
    assert received[0]["topic"] == "agent.chat.scout"
    assert received[0]["payload"] == {"text": "hi"}
    assert received[0]["from"] == "broker"


async def test_publish_does_not_deliver_to_non_match():
    ps = PubSub()
    received: list[dict] = []

    async def consume():
        async for msg in ps.subscribe(["agent.chat.+"]):
            received.append(msg)
            return

    task = asyncio.create_task(consume())
    await asyncio.sleep(0)
    await ps.publish("task.42", {}, sender="x")
    await ps.publish("agent.chat.scout", {"hit": True}, sender="x")
    await task
    assert len(received) == 1
    assert received[0]["topic"] == "agent.chat.scout"


async def test_history_returns_published_topics():
    ps = PubSub()
    await ps.publish("system", {"heartbeat": True}, sender="system")
    hist = ps.history("system", limit=10)
    assert any("heartbeat" in str(m["payload"]) for m in hist)
