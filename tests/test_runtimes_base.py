from visionary.runtimes.base import DispatchContext, DispatchResult
from visionary.runtimes.registry import Registry


class FakeAdapter:
    name = "fake"

    async def dispatch(self, ctx: DispatchContext) -> DispatchResult:
        return DispatchResult(ok=True, output="hi", error=None, exhausted=False)

    async def healthcheck(self) -> bool:
        return True


def test_registry_stores_and_returns_adapter():
    reg = Registry()
    reg.register(FakeAdapter())
    assert reg.get("fake").name == "fake"
    assert reg.has("fake")


def test_registry_returns_none_for_unknown():
    reg = Registry()
    assert reg.get("nope") is None
    assert reg.has("nope") is False


def test_dispatch_result_dataclass_round_trip():
    r = DispatchResult(ok=True, output="x", error=None, exhausted=False, harness_used="claude")
    assert r.ok is True
    assert r.output == "x"
    assert r.harness_used == "claude"
