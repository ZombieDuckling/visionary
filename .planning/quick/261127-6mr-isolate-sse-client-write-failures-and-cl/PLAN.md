---
type: quick
status: planned
files_modified:
  - sse.js
  - tests/sse.test.mjs
---

# Isolate SSE client write failures and clean up disconnected streams

## Scope

Continue the GSD quick task initialized via the installed legacy `gsd-tools.cjs init quick` command. One SSE client's write failure must not interrupt delivery to healthy clients or escape into the caller. Cleanup for a failed or disconnected response must be centralized and idempotent: stop future writes and the keepalive timer, and do it for request close, response close, response error, synchronous write throws, write callback errors (initial, broadcast, and keepalive), and responses that are already destroyed.

Preserve `module.exports` (`bus`, `handleSSE`, `broadcast`), SSE headers, framing, monotonic event ids, `retry: 3000`, and the 30s `: keepalive` comment. Preserve backpressure behavior: a `write` that returns `false` has buffered the payload and leaves the client connected. Do not add buffering, event replay, or a new slow-client policy.

## Decision

Reliability here is a bounded context around one connection. A failing stream is removed and terminated on a write or response error; request/response close and already destroyed or ended responses release the client without a second termination. The harmless `error` listener stays attached.

## Execution

1. Add `tests/sse.test.mjs` with EventEmitter response doubles, `node:test` mock timers, and one ephemeral `127.0.0.1` HTTP smoke. Run it against the current `sse.js` and record the failures.
2. Implement one idempotent per-client release used by `handleSSE` and `broadcast`. Clear the keepalive timer, drop the client, and on write failure call `destroy()` when the response is still open. Catch synchronous `write` throws per client and continue the fan-out. Treat callback `err` as the same failure. Keep `write() === false` as backpressure.
3. Re-run `node --test --test-concurrency=1 tests/sse.test.mjs` with `TMPDIR=/Users/joshuasack/.hermes/cache/scratch`. Parent handles full verification, SUMMARY/STATE, and any commit.

## Acceptance

- A synchronous `write` throw while broadcasting still delivers that same event to a healthy client and does not throw to the caller.
- An asynchronous `write` callback error removes that client so a later broadcast does not write to it; a healthy client still receives events.
- Response `close`, response `error`, and an already `destroyed` response produce no later keepalive writes.
- A synchronous throw or callback error on the initial `:ok` / `retry` write never leaves that response registered or on a keepalive timer.
- A keepalive `write` throw or callback error clears the timer so the interval does not fire again.
- Happy-path bytes stay `:ok`, `retry: 3000`, `id` / `event` / `data` framing, and strictly increasing ids. Headers stay `text/event-stream`, `no-cache`, `keep-alive`, and `X-Accel-Buffering: no`.
- `write` returning `false` does not drop the client.
- Cleanup is idempotent, and a late `error` after release does not become an unhandled error.
- Tests are deterministic doubles plus at most one localhost smoke server. No production server, database, install, or network send.

## Limits

`destroy()` aborts that response; reconnect behavior stays the existing `retry: 3000` hint. This does not add monitoring, replay, or a buffer for slow clients. `clients` and `eventId` stay process-global. Reusing one response object for a second `handleSSE` call is outside this boundary. Parent owns SUMMARY, STATE, commits, and the full suite.
