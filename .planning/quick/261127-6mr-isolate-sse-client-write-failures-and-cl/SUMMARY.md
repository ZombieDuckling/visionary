---
type: quick
status: complete
date: 2026-11-27
---

# SSE client failure isolation

## Outcome

A failing SSE response no longer interrupts the broadcast loop or throws a client write error into a domain operation. Initial writes, broadcasts and heartbeat writes share the same guarded writer; thrown errors and callback errors release that client and terminate its response. Request/response close, response error, destroyed responses and ended responses stop future writes and clear the heartbeat timer. Cleanup is idempotent and late response errors remain handled.

Exports, headers, event framing, monotonic IDs, 3-second retry hint and 30-second heartbeat cadence are unchanged. Existing backpressure behavior remains unchanged: `write(false)` has buffered the message, not rejected it. This change does not add replay or bounded slow-client buffering.

## Scope and execution

- Initialized through installed legacy `gsd-tools.cjs init quick`; the newer `gsd-sdk` command is unavailable.
- Cursor wrote the scoped plan and regression tests, then its command timed out after 600 seconds before implementation. Hermes recovered the partial work, reproduced failures, implemented the fix and extended tests. No failed child result is being treated as verification.
- Preexisting README and artifact-secret-scan edits and the 261126 planning directory were neither edited nor staged by this task.
- No production service restart, migration, or live database operation was performed. Tests use disposable databases and localhost servers.

## Verification

The initial 14-test regression suite against unchanged `sse.js`: **6 passed, 8 failed**. After implementation it passed. Additional deferred-handshake, initially closed response and heartbeat cadence tests bring targeted coverage to **19 passed, 0 failed**.

Final verification was run against an archive of committed HEAD with only `sse.js` and `tests/sse.test.mjs` overlaid, proving no dependency on preexisting uncommitted work:

- `node --test --test-timeout=10000 tests/sse.test.mjs`: 19 passed, 0 failed, including a native HTTP handshake/event smoke.
- `npm run check`: exit 0; org-chart validation passed (16 nodes).
- `npm run test:unit`: 591 passed, 0 failed.
- `npm run smoke`: 41 passed, 0 failed.
- `npm run test:stream`: ALL STREAM CHECKS PASSED (stub runtimes, no provider calls).

Clean verification directory: `/Users/joshuasack/.hermes/cache/scratch/visionary-sse-verify-7s1eq9cn`.
Logs: `/Users/joshuasack/.hermes/cache/scratch/visionary-sse-final-{targeted,check,unit,smoke,stream}.log` (ephemeral).
Node emits its expected experimental MockTimers warning; no test skips or failures.

## Learning applied

The injected Jake ingestion reported no new videos and deeper evidence for `ezRtp6K6zwE` and `0fCQ-4J_jzk`; both notes were read. The production-engineering lesson in `ezRtp6K6zwE` (32:10–38:00) favors deterministic reliability boundaries over more agent features. Applied here to the dashboard transport: one broken browser stream must not disrupt healthy clients or application work. Hermes remains the maintainer; Visionary remains a separate product.

## Deployment limit

Verified source change only; an already-running Visionary process needs its normal restart to load it. Event replay, reconnect state resynchronization and slow-client memory bounds remain outside this small fix.
