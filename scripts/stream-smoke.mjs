// Integration check for streaming dispatch + failover + cancellation.
// Runs the real failover engine against a temp DB with fast stub runtimes.
// Usage: VISIONARY_DB=/tmp/x.sqlite node scripts/stream-smoke.mjs
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.VISIONARY_DB = join(mkdtempSync(join(tmpdir(), 'vis-stream-')), 'test.sqlite');

const { db, stmts } = require('../db');
const runtimes = require('../src/runtimes');

const NODE = process.execPath;
// Fast streaming stub: emits two chunks with a gap so we can see streaming.
runtimes.registerRuntime('stub', {
  name: 'stub',
  buildCommand: () => ({ bin: NODE, args: ['-e', 'process.stdout.write("chunk1 ");setTimeout(()=>process.stdout.write("chunk2"),40)'] })
});
// A harness that immediately looks rate-limited so failover should skip it.
runtimes.registerRuntime('boom', {
  name: 'boom',
  buildCommand: () => ({ bin: NODE, args: ['-e', 'process.stderr.write("rate limit exceeded");process.exit(1)'] })
});
// A harness that runs long enough to be cancelled.
runtimes.registerRuntime('slow', {
  name: 'slow',
  buildCommand: () => ({ bin: NODE, args: ['-e', 'setTimeout(()=>process.stdout.write("done"),5000)'] })
});

const deps = { getRuntime: runtimes.getRuntime, stmts, db };
let failures = 0;
function check(name, cond) { console.log((cond ? 'ok  ' : 'FAIL ') + name); if (!cond) failures++; }

// 1) Streaming on a single harness
{
  const chunks = [];
  const harnessStarts = [];
  const agent = { id: 'scout', harness_chain: JSON.stringify(['stub']), current_harness: 'stub' };
  const res = await runtimes.executeWithFailover(deps, agent, { message: 'hi' }, {
    timeout: 5000,
    onChunk: (h, c, s) => chunks.push({ h, c, s }),
    onHarnessStart: (h, i, t) => harnessStarts.push({ h, i, t })
  });
  check('stream: status ok', res.status === 'ok');
  check('stream: full stdout assembled', /chunk1 chunk2/.test(res.stdout || ''));
  check('stream: onChunk fired', chunks.length >= 1 && chunks.every(c => c.s === 'stdout'));
  check('stream: onHarnessStart fired with stub', harnessStarts.length === 1 && harnessStarts[0].h === 'stub' && harnessStarts[0].t === 1);
}

// 2) Failover: boom (rate-limited) -> stub (ok)
{
  const harnessStarts = [];
  const agent = { id: 'analyst', harness_chain: JSON.stringify(['boom', 'stub']), current_harness: 'boom' };
  const res = await runtimes.executeWithFailover(deps, agent, { message: 'hi' }, {
    timeout: 5000,
    onChunk: () => {},
    onHarnessStart: (h) => harnessStarts.push(h)
  });
  check('failover: ended on stub ok', res.status === 'ok' && res.harness === 'stub');
  check('failover: walked boom then stub', harnessStarts.join(',') === 'boom,stub');
  check('failover: recorded 2 attempts', Array.isArray(res.attempts) && res.attempts.length === 2 && res.attempts[0].status === 'exhausted');
}

// 3) Cancellation: slow harness cancelled mid-flight should NOT fail over
{
  let cancelled = false;
  const harnessStarts = [];
  const agent = { id: 'forge', harness_chain: JSON.stringify(['slow', 'stub']), current_harness: 'slow' };
  const p = runtimes.executeWithFailover(deps, agent, { message: 'hi' }, {
    timeout: 8000,
    onChunk: () => {},
    onHarnessStart: (h) => harnessStarts.push(h),
    onChild: (child) => { setTimeout(() => { cancelled = true; child.kill('SIGTERM'); }, 200); },
    isCancelled: () => cancelled
  });
  const res = await p;
  check('cancel: status cancelled', res.status === 'cancelled');
  check('cancel: did NOT fail over to stub', harnessStarts.join(',') === 'slow');
}

db.close();
console.log(failures === 0 ? '\nALL STREAM CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
