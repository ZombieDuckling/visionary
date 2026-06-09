import stat
from pathlib import Path

from visionary.runtimes.base import DispatchContext
from visionary.runtimes.openclaw import OpenClawAdapter


def _make_stub(tmp_path: Path, body: str) -> str:
    stub = tmp_path / "openclaw"
    stub.write_text(f"#!/bin/bash\n{body}\n")
    stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
    return str(stub)


async def test_dispatch_returns_output_on_success(tmp_path, monkeypatch):
    stub = _make_stub(tmp_path, 'echo "hello from openclaw"')
    monkeypatch.setenv("OPENCLAW_BIN", stub)
    a = OpenClawAdapter()
    r = await a.dispatch(DispatchContext(agent_id="scout", prompt="hi"))
    assert r.ok is True
    assert "hello from openclaw" in r.output
    assert r.harness_used == "openclaw"


async def test_dispatch_detects_exhaustion_in_stderr(tmp_path, monkeypatch):
    stub = _make_stub(tmp_path, 'echo "quota exceeded" >&2; exit 1')
    monkeypatch.setenv("OPENCLAW_BIN", stub)
    a = OpenClawAdapter()
    r = await a.dispatch(DispatchContext(agent_id="scout", prompt="hi"))
    assert r.ok is False
    assert r.exhausted is True


async def test_dispatch_returns_failure_on_other_error(tmp_path, monkeypatch):
    stub = _make_stub(tmp_path, 'echo "some random error" >&2; exit 2')
    monkeypatch.setenv("OPENCLAW_BIN", stub)
    a = OpenClawAdapter()
    r = await a.dispatch(DispatchContext(agent_id="scout", prompt="hi"))
    assert r.ok is False
    assert r.exhausted is False


async def test_healthcheck_returns_true_for_present_binary(tmp_path, monkeypatch):
    stub = _make_stub(tmp_path, 'echo "openclaw 1.0"')
    monkeypatch.setenv("OPENCLAW_BIN", stub)
    a = OpenClawAdapter()
    assert await a.healthcheck() is True


async def test_healthcheck_returns_false_for_missing_binary(monkeypatch):
    monkeypatch.setenv("OPENCLAW_BIN", "/nonexistent/openclaw-bin")
    a = OpenClawAdapter()
    assert await a.healthcheck() is False
