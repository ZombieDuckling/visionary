import stat
from pathlib import Path

from visionary.runtimes.base import DispatchContext
from visionary.runtimes.claude import ClaudeAdapter


def _make_stub(tmp_path: Path, body: str) -> str:
    stub = tmp_path / "claude"
    stub.write_text(f"#!/bin/bash\n{body}\n")
    stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
    return str(stub)


async def test_dispatch_returns_output_on_success(tmp_path, monkeypatch):
    stub = _make_stub(tmp_path, 'echo "hello from claude"')
    monkeypatch.setenv("CLAUDE_BIN", stub)
    a = ClaudeAdapter()
    r = await a.dispatch(DispatchContext(agent_id="scout", prompt="hi"))
    assert r.ok is True
    assert "hello from claude" in r.output
    assert r.harness_used == "claude"


async def test_dispatch_detects_exhaustion_in_stderr(tmp_path, monkeypatch):
    stub = _make_stub(tmp_path, 'echo "rate limit exceeded" >&2; exit 1')
    monkeypatch.setenv("CLAUDE_BIN", stub)
    a = ClaudeAdapter()
    r = await a.dispatch(DispatchContext(agent_id="scout", prompt="hi"))
    assert r.ok is False
    assert r.exhausted is True


async def test_dispatch_returns_failure_on_other_error(tmp_path, monkeypatch):
    stub = _make_stub(tmp_path, 'echo "some random error" >&2; exit 2')
    monkeypatch.setenv("CLAUDE_BIN", stub)
    a = ClaudeAdapter()
    r = await a.dispatch(DispatchContext(agent_id="scout", prompt="hi"))
    assert r.ok is False
    assert r.exhausted is False


async def test_healthcheck_returns_true_for_present_binary(tmp_path, monkeypatch):
    stub = _make_stub(tmp_path, 'echo "claude 1.0"')
    monkeypatch.setenv("CLAUDE_BIN", stub)
    a = ClaudeAdapter()
    assert await a.healthcheck() is True


async def test_healthcheck_returns_false_for_missing_binary(monkeypatch):
    monkeypatch.setenv("CLAUDE_BIN", "/nonexistent/claude-bin")
    a = ClaudeAdapter()
    assert await a.healthcheck() is False
