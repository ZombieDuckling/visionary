#!/usr/bin/env python3
"""
Visionary Agent Bridge — persistent messaging daemon for real-time agent chatter.

Architecture:
  - WebSocket server (port 3334): agents connect directly for real-time pub/sub
  - HTTP API   (port 3335): Node.js server integration for inter-agent messaging
  - SQLite integration: bridges write through to visionary.sqlite activity_log
  - Topic-based pub/sub with MQTT-style wildcards (+ single-level, # multi-level)

Topics:
  agent.chat.<agent_id>     — direct messages to a specific agent
  agent.status.<agent_id>   — status changes (online, offline, working, idle)
  agent.alert.<agent_id>    — urgent messages requiring immediate attention
  task.<task_id>            — task lifecycle events (created, updated, dispatched, completed)
  system                    — bridge health, agent registry, heartbeats

Protocol (WebSocket JSON messages):
  Subscribe:  {"type":"subscribe",  "topics":["agent.chat.#","task.#"]}
  Unsubscribe:{"type":"unsubscribe","topics":["agent.chat.scout"]}
  Publish:    {"type":"publish",    "topic":"agent.chat.broker", "payload":{...}, "from":"scout"}
  Message:    {"type":"message",    "topic":"...", "payload":{...}, "from":"...", "ts":"..."}
  Heartbeat:  {"type":"ping"} / {"type":"pong"}
"""

import asyncio
import json
import sqlite3
import time
import os
import re
import http
import signal
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs

try:
    import websockets
    from websockets.asyncio.server import serve, ServerConnection
except ImportError:
    print("ERROR: websockets not installed. Run: pip install websockets")
    sys.exit(1)

# ── Config ──────────────────────────────────────────────────────────
WS_PORT = int(os.environ.get("BRIDGE_WS_PORT", "3334"))
HTTP_PORT = int(os.environ.get("BRIDGE_HTTP_PORT", "3335"))
DB_PATH = os.environ.get("VISIONARY_DB", os.path.join(os.path.dirname(__file__), "visionary.sqlite"))
MAX_MSG_HISTORY = int(os.environ.get("BRIDGE_MSG_HISTORY", "100"))
MAX_BODY_BYTES = int(os.environ.get("BRIDGE_MAX_BODY", "65536"))
HEARTBEAT_INTERVAL = 30

# ── Message Store ───────────────────────────────────────────────────
db_conn: sqlite3.Connection | None = None

def get_db() -> sqlite3.Connection:
    global db_conn
    if db_conn is None:
        db_conn = sqlite3.connect(DB_PATH, timeout=5)
        db_conn.row_factory = sqlite3.Row
        db_conn.execute("PRAGMA journal_mode = WAL")
        db_conn.execute("PRAGMA busy_timeout = 5000")
    return db_conn

def write_activity(event_type: str, agent_id: str | None, task_id: int | None,
                   summary: str, detail: dict | None = None) -> int:
    db = get_db()
    cur = db.execute(
        "INSERT INTO activity_log (event_type, agent_id, task_id, summary, detail_json) "
        "VALUES (?, ?, ?, ?, ?)",
        (event_type, agent_id, task_id, summary[:500],
         json.dumps(detail) if detail else None)
    )
    db.commit()
    return cur.lastrowid

# ── Topic Matcher ───────────────────────────────────────────────────
def topic_matches(subscription: str, topic: str) -> bool:
    """MQTT-style wildcard matching: + matches one level, # matches rest."""
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

# ── Pub/Sub Engine ──────────────────────────────────────────────────
class PubSub:
    def __init__(self):
        self.subscriptions: dict[ServerConnection, set[str]] = {}
        self.presence: dict[str, dict] = {}  # agent_id -> {conn, connected_at, status}
        self.msg_history: dict[str, list[dict]] = {}  # topic -> [msg, ...]

    def subscribe(self, conn: ServerConnection, topics: list[str]):
        if conn not in self.subscriptions:
            self.subscriptions[conn] = set()
        self.subscriptions[conn].update(topics)

    def unsubscribe(self, conn: ServerConnection, topics: list[str]):
        if conn in self.subscriptions:
            for t in topics:
                self.subscriptions[conn].discard(t)

    def remove_conn(self, conn: ServerConnection):
        self.subscriptions.pop(conn, None)
        for aid, info in list(self.presence.items()):
            if info.get("conn") is conn:
                del self.presence[aid]
                self.publish_system("agent.status." + aid, {
                    "agent_id": aid, "status": "offline",
                    "previous": info.get("status", "unknown")
                })

    def publish(self, topic: str, payload: dict, sender: str = "system"):
        msg = {
            "type": "message",
            "topic": topic,
            "payload": payload,
            "from": sender,
            "ts": datetime.now(timezone.utc).isoformat()
        }

        if topic not in self.msg_history:
            self.msg_history[topic] = []
        self.msg_history[topic].append(msg)
        if len(self.msg_history[topic]) > MAX_MSG_HISTORY:
            self.msg_history[topic] = self.msg_history[topic][-MAX_MSG_HISTORY:]

        dead_conns = []
        for conn, subs in self.subscriptions.items():
            if any(topic_matches(sub, topic) for sub in subs):
                try:
                    asyncio.ensure_future(self._send(conn, msg))
                except Exception:
                    dead_conns.append(conn)
        for dc in dead_conns:
            self.remove_conn(dc)

    def publish_system(self, topic: str, payload: dict):
        self.publish(topic, payload, sender="system")
        write_activity("bridge." + topic.replace(".", "_"), payload.get("agent_id"), None,
                       payload.get("status", topic), payload)

    async def _send(self, conn: ServerConnection, msg: dict):
        try:
            await conn.send(json.dumps(msg, ensure_ascii=False, default=str))
        except websockets.exceptions.ConnectionClosed:
            pass

    def presence_list(self) -> list[dict]:
        return [
            {"agent_id": aid, "status": info.get("status", "idle"),
             "connected_at": info.get("connected_at")}
            for aid, info in self.presence.items()
        ]

pubsub = PubSub()

# ── WebSocket Handler ───────────────────────────────────────────────
async def handle_ws(conn: ServerConnection):
    remote = conn.remote_address
    agent_id = None
    try:
        async for raw in conn:
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await conn.send(json.dumps({"type": "error", "error": "invalid JSON"}))
                continue

            msg_type = data.get("type")

            if msg_type == "ping":
                await conn.send(json.dumps({"type": "pong"}))

            elif msg_type == "subscribe":
                topics = data.get("topics", [])
                if not isinstance(topics, list):
                    await conn.send(json.dumps({"type": "error", "error": "topics must be a list"}))
                    continue
                pubsub.subscribe(conn, topics)
                ok_topics = [t for t in topics if isinstance(t, str)]
                if agent_id:
                    aid = agent_id
                    for t in ok_topics:
                        pubsub.publish("system", {"type": "subscribed", "topic": t, "agent_id": aid}, sender="system")

            elif msg_type == "unsubscribe":
                topics = data.get("topics", [])
                if isinstance(topics, list):
                    pubsub.unsubscribe(conn, topics)

            elif msg_type == "publish":
                topic = data.get("topic", "")
                payload = data.get("payload", {})
                sender = data.get("from") or agent_id or "anonymous"
                if not topic:
                    await conn.send(json.dumps({"type": "error", "error": "topic required"}))
                    continue
                if not isinstance(payload, dict):
                    await conn.send(json.dumps({"type": "error", "error": "payload must be an object"}))
                    continue

                pubsub.publish(topic, payload, sender=sender)
                write_activity("bridge.publish", sender, None,
                               f"published to {topic}", {"topic": topic, "payload": payload})

            elif msg_type == "presence":
                agent_id = data.get("agent_id")
                status = data.get("status", "idle")
                if agent_id:
                    old_status = None
                    if agent_id in pubsub.presence:
                        old_status = pubsub.presence[agent_id].get("status")
                    pubsub.presence[agent_id] = {
                        "conn": conn, "status": status,
                        "connected_at": pubsub.presence.get(agent_id, {}).get("connected_at", time.time())
                    }
                    if old_status != status:
                        pubsub.publish_system("agent.status." + agent_id, {
                            "agent_id": agent_id, "status": status, "previous": old_status
                        })

            elif msg_type == "history":
                topic_filter = data.get("topic", "#")
                limit = min(data.get("limit", 20), 100)
                results = []
                for t, msgs in pubsub.msg_history.items():
                    if topic_matches(topic_filter, t):
                        results.extend(msgs)
                results.sort(key=lambda m: m.get("ts", ""), reverse=True)
                await conn.send(json.dumps({
                    "type": "history",
                    "messages": results[:limit]
                }, ensure_ascii=False, default=str))

            else:
                await conn.send(json.dumps({"type": "error", "error": f"unknown type: {msg_type}"}))

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        pubsub.remove_conn(conn)

# ── HTTP API (for Node.js integration) ──────────────────────────────
async def handle_http(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    try:
        raw = b""
        while True:
            chunk = await asyncio.wait_for(reader.read(4096), timeout=30)
            if not chunk:
                break
            raw += chunk
            if b"\r\n\r\n" in raw:
                break
            if len(raw) > 8192:
                break

        request_line, rest = raw.split(b"\r\n", 1)
        method, path, _ = request_line.decode().split(" ")
        parsed = urlparse(path)
        pathname = parsed.path
        headers_raw = rest.split(b"\r\n\r\n", 1)
        body_raw = headers_raw[1] if len(headers_raw) > 1 else b""

        if method == "GET" and pathname == "/health":
            await _http_json(writer, {"ok": True, "agents_connected": len(pubsub.presence),
                                       "topics": len(pubsub.msg_history)})

        elif method == "GET" and pathname == "/presence":
            await _http_json(writer, {"agents": pubsub.presence_list()})

        elif method == "POST" and pathname == "/publish":
            try:
                body = json.loads(body_raw[:MAX_BODY_BYTES].decode())
            except (json.JSONDecodeError, UnicodeDecodeError):
                await _http_json(writer, {"error": "invalid JSON body"}, 400)
                return

            topic = body.get("topic", "")
            payload = body.get("payload", {})
            sender = body.get("from", "node-server")
            if not topic:
                await _http_json(writer, {"error": "topic required"}, 400)
                return
            pubsub.publish(topic, payload, sender=sender)
            await _http_json(writer, {"ok": True, "topic": topic})

        elif method == "POST" and pathname == "/message":
            try:
                body = json.loads(body_raw[:MAX_BODY_BYTES].decode())
            except (json.JSONDecodeError, UnicodeDecodeError):
                await _http_json(writer, {"error": "invalid JSON body"}, 400)
                return

            to_agent = body.get("to", "")
            from_agent = body.get("from", "system")
            subject = body.get("subject", "")
            text = body.get("body", "")
            task_id = body.get("task_id")

            if not to_agent or not subject:
                await _http_json(writer, {"error": "to and subject required"}, 400)
                return

            pubsub.publish("agent.chat." + to_agent, {
                "from": from_agent, "subject": subject, "body": text, "task_id": task_id
            }, sender=from_agent)

            write_activity("bridge.message", from_agent, task_id,
                           f"{from_agent} -> {to_agent}: {subject}", body)

            await _http_json(writer, {"ok": True, "routed_to": to_agent})

        elif method == "GET" and pathname.startswith("/history/"):
            topic_filter = pathname[len("/history/"):]
            limit = int(parse_qs(parsed.query).get("limit", [20])[0])
            limit = min(limit, 100)
            results = []
            for t, msgs in pubsub.msg_history.items():
                if topic_matches(topic_filter, t):
                    results.extend(msgs)
            results.sort(key=lambda m: m.get("ts", ""), reverse=True)
            await _http_json(writer, {"topic": topic_filter, "messages": results[:limit]})

        else:
            await _http_json(writer, {"error": "not found"}, 404)

    except (asyncio.TimeoutError, ConnectionResetError, BrokenPipeError):
        pass
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass

async def _http_json(writer: asyncio.StreamWriter, data: dict, status: int = 200):
    body = json.dumps(data, ensure_ascii=False, default=str).encode()
    resp = (
        f"HTTP/1.1 {status} {'OK' if status == 200 else 'Error'}\r\n"
        f"Content-Type: application/json\r\n"
        f"Content-Length: {len(body)}\r\n"
        f"Access-Control-Allow-Origin: *\r\n"
        f"Connection: close\r\n\r\n"
    ).encode() + body
    writer.write(resp)
    await writer.drain()

# ── Heartbeat ───────────────────────────────────────────────────────
async def heartbeat_loop():
    while True:
        await asyncio.sleep(HEARTBEAT_INTERVAL)
        pubsub.publish_system("system", {"type": "heartbeat", "ts": time.time()})

# ── Shutdown ────────────────────────────────────────────────────────
shutdown_event = asyncio.Event()

def signal_handler():
    shutdown_event.set()

# ── Main ────────────────────────────────────────────────────────────
async def main():
    print(f"[bridge] Visionary Agent Bridge starting...")
    print(f"[bridge]  WS port: {WS_PORT} (agent connections)")
    print(f"[bridge]  HTTP port: {HTTP_PORT} (Node.js integration)")
    print(f"[bridge]  DB: {DB_PATH}")

    ws_server = await serve(handle_ws, "127.0.0.1", WS_PORT)
    http_server = await asyncio.start_server(handle_http, "127.0.0.1", HTTP_PORT)

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, signal_handler)
        except NotImplementedError:
            pass

    asyncio.create_task(heartbeat_loop())

    print(f"[bridge] Ready. WS=127.0.0.1:{WS_PORT} HTTP=127.0.0.1:{HTTP_PORT}")

    try:
        await shutdown_event.wait()
    finally:
        print("[bridge] Shutting down...")
        ws_server.close()
        http_server.close()
        await ws_server.wait_closed()
        await http_server.wait_closed()
        if db_conn:
            db_conn.close()
        print("[bridge] Shutdown complete.")

if __name__ == "__main__":
    asyncio.run(main())
