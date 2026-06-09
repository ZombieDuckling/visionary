import asyncio

from visionary.sse.bus import EventBus


async def test_event_bus_delivers_to_subscriber():
    bus = EventBus()
    received: list[dict] = []

    async def consume() -> None:
        async for event in bus.subscribe():
            received.append(event)
            if len(received) >= 2:
                return

    consumer = asyncio.create_task(consume())
    # Give consumer a tick to subscribe
    await asyncio.sleep(0)

    await bus.publish({"type": "test", "payload": {"n": 1}})
    await bus.publish({"type": "test", "payload": {"n": 2}})
    await consumer

    assert len(received) == 2
    assert received[0]["payload"]["n"] == 1
    assert received[1]["payload"]["n"] == 2


async def test_event_bus_supports_multiple_subscribers():
    bus = EventBus()
    a: list[dict] = []
    b: list[dict] = []

    async def consume(into: list[dict]) -> None:
        async for event in bus.subscribe():
            into.append(event)
            if len(into) >= 1:
                return

    ca = asyncio.create_task(consume(a))
    cb = asyncio.create_task(consume(b))
    await asyncio.sleep(0)

    await bus.publish({"type": "broadcast", "payload": {"hi": "all"}})
    await ca
    await cb

    assert len(a) == 1
    assert len(b) == 1
    assert a[0]["payload"]["hi"] == "all"
    assert b[0]["payload"]["hi"] == "all"


async def test_event_bus_unsubscribe_drops_client():
    bus = EventBus()

    async def consume_one() -> None:
        async for _event in bus.subscribe():
            return  # drop subscription after one event

    task = asyncio.create_task(consume_one())
    await asyncio.sleep(0)

    await bus.publish({"type": "x", "payload": {}})
    await task
    await asyncio.sleep(0)  # let generator finally block complete cleanup

    # After consumer drains, internal client count returns to 0
    assert bus.subscriber_count() == 0
