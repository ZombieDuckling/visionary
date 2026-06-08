#!/usr/bin/env python3
"""
Visionary Watchdog
==================

Independent process. Polls the Visionary server every N seconds, runs
health checks on every agent's current harness, and triggers failover
on the server when a harness is unhealthy or an agent has been idle
beyond its `expected_activity_within_seconds`.

Usage:
    python3 watchdog.py                  # default 60s interval
    WATCHDOG_INTERVAL=30 python3 watchdog.py
    WATCHDOG_BASE=http://127.0.0.1:3333 python3 watchdog.py

The watchdog never runs an agent itself — it only calls server endpoints:
  * GET  /api/org
  * POST /api/agents/:id/health-check
  * POST /api/agents/:id/dispatch  (only when invoked manually via reincarnate)
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("WATCHDOG_BASE", "http://127.0.0.1:3333")
INTERVAL = int(os.environ.get("WATCHDOG_INTERVAL", "60"))
HTTP_TIMEOUT = int(os.environ.get("WATCHDOG_HTTP_TIMEOUT", "15"))


def _http(method: str, path: str, payload: dict | None = None) -> dict:
    url = BASE.rstrip("/") + path
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data is not None else {},
    )
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
        body = resp.read().decode("utf-8")
        if not body:
            return {}
        return json.loads(body)


def _now_utc() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc)


def _parse_sqlite_ts(ts: str | None) -> _dt.datetime | None:
    """SQLite datetime('now') format: 'YYYY-MM-DD HH:MM:SS' (UTC, no tz)."""
    if not ts:
        return None
    try:
        return _dt.datetime.strptime(ts, "%Y-%m-%d %H:%M:%S").replace(
            tzinfo=_dt.timezone.utc
        )
    except ValueError:
        return None


def fetch_org() -> list[dict]:
    """Return flat list of all agents from /api/org."""
    org = _http("GET", "/api/org")
    return org.get("all", [])


def health_check(agent_id: str) -> dict:
    return _http("POST", f"/api/agents/{agent_id}/health-check")


def evaluate(agent: dict) -> tuple[str, str]:
    """
    Decide what action this agent needs.
    Returns (action, reason). Action is one of: 'ok', 'health-check', 'stale-activity'.
    """
    health = (agent.get("health_status") or "unknown").lower()
    last_check = _parse_sqlite_ts(agent.get("last_health_check"))
    last_activity = _parse_sqlite_ts(agent.get("last_activity_at"))
    expected = agent.get("expected_activity_within_seconds") or 7200
    now = _now_utc()

    # Always re-check when no record or check is stale (>10x interval)
    if last_check is None or (now - last_check).total_seconds() > INTERVAL * 10:
        return ("health-check", "no recent health check")
    if health in ("fail", "unknown"):
        return ("health-check", f"current health status is {health}")
    # Periodic re-check every ~5 intervals even if previously ok
    if (now - last_check).total_seconds() > INTERVAL * 5:
        return ("health-check", "periodic re-check")
    # Activity check (agent should be doing something within its expected window)
    if last_activity is None:
        return ("stale-activity", "no activity recorded yet")
    idle = (now - last_activity).total_seconds()
    if idle > expected:
        return ("stale-activity", f"idle for {int(idle)}s (>{expected}s expected)")
    return ("ok", "fresh and healthy")


def cycle() -> None:
    try:
        agents = fetch_org()
    except (urllib.error.URLError, json.JSONDecodeError) as err:
        print(f"[watchdog] cannot reach server at {BASE}: {err}", file=sys.stderr)
        return

    print(f"[watchdog] cycle @ {_now_utc().isoformat(timespec='seconds')} ({len(agents)} agents)")

    for agent in sorted(agents, key=lambda a: (a.get("role") or "", a.get("id") or "")):
        action, reason = evaluate(agent)
        name = agent.get("name") or agent.get("id")
        harness = agent.get("current_harness") or "?"
        if action == "ok":
            continue
        if action == "health-check":
            try:
                result = health_check(agent["id"])
                print(f"[watchdog] {name:>22} via {harness:<12} → check: {result.get('status')} ({reason})")
            except (urllib.error.URLError, KeyError) as err:
                print(f"[watchdog] {name}: health-check failed: {err}", file=sys.stderr)
        elif action == "stale-activity":
            print(
                f"[watchdog] {name:>22} via {harness:<12} → STALE: {reason}",
                file=sys.stderr,
            )
            # Future hook: enqueue a 'nudge' dispatch with the agent's
            # watchdog_role so it picks back up. For now we only log so
            # the operator can decide whether to intervene.


def main() -> int:
    print(f"[watchdog] starting (base={BASE} interval={INTERVAL}s timeout={HTTP_TIMEOUT}s)")
    while True:
        try:
            cycle()
        except KeyboardInterrupt:
            print("[watchdog] stopping (SIGINT)")
            return 0
        except Exception as err:  # noqa: BLE001
            print(f"[watchdog] cycle error: {err}", file=sys.stderr)
        time.sleep(INTERVAL)


if __name__ == "__main__":
    raise SystemExit(main())
