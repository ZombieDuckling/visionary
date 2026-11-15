// Unit tests for src/run-reconciliation.js — restart/shutdown reconciliation of
// run rows that still claim to be live.
//
// These run against a real SQLite file (the same migrations the server uses) so
// the guarded UPDATE and the derived duration_ms are exercised, not mocked. The
// contract being tested: only `pending`/`running` rows are touched, a terminal
// row is never overwritten, a repeated pass is a no-op, the recorded error says
// what happened and when, and the shutdown path only reconciles the run ids the
// dying process actually owned.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tmpRoot = mkdtempSync(join(tmpdir(), 'visionary-reconcile-'));
process.env.VISIONARY_DB = join(tmpRoot, 'state.sqlite');

const { db, stmts } = require('../db.js');
const {
  reconcileOrphanedRuns,
  summarizeReconciliation,
  buildInterruptMessage,
  LIVE_RUN_STATUSES
} = require('../src/run-reconciliation.js');

after(() => {
  try { db.close(); } catch { /* already closed */ }
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

let seeded = 0;
function seedTask(id, title) {
  db.prepare('INSERT INTO tasks (id, title, status) VALUES (?, ?, ?)').run(id, title, 'in_progress');
  return id;
}
function seedRun({ agentId = 'argus', status = 'running', taskId = null, ageHours = 1 } = {}) {
  seeded += 1;
  const message = 'reconcile-seed-' + seeded;
  db.prepare(`
    INSERT INTO agent_runs (task_id, agent_id, message, status, started_at)
    VALUES (?, ?, ?, ?, datetime('now', ?))
  `).run(taskId, agentId, message, status, '-' + ageHours + ' hours');
  return db.prepare('SELECT * FROM agent_runs WHERE message = ?').get(message).id;
}

test('boot reconciliation marks orphaned pending/running rows timeout and leaves terminal rows alone', () => {
  seedTask(101, 'Reconcile task A');
  const runningId = seedRun({ status: 'running', taskId: 101, ageHours: 3 });
  const pendingId = seedRun({ status: 'pending', ageHours: 1 });
  const doneId = seedRun({ status: 'completed', ageHours: 2 });
  const failedId = seedRun({ status: 'failed', ageHours: 2 });

  const result = reconcileOrphanedRuns({
    stmts,
    source: 'boot',
    now: new Date('2026-11-15T02:45:00.000Z')
  });

  assert.equal(result.source, 'boot');
  assert.equal(result.at, '2026-11-15T02:45:00.000Z');
  assert.equal(result.count, 2, 'exactly the two live rows are reconciled');
  const ids = result.reconciled.map((r) => r.id).sort((a, b) => a - b);
  assert.deepEqual(ids, [runningId, pendingId].sort((a, b) => a - b));
  assert.deepEqual(result.task_ids, [101], 'task ids are deduped and reported');

  for (const entry of result.reconciled) {
    const row = stmts.getRunById.get(entry.id);
    assert.equal(row.status, 'timeout');
    assert.ok(row.completed_at, 'completed_at is set');
    assert.ok(Number.isFinite(row.duration_ms) && row.duration_ms >= 0, 'duration_ms derived from started_at');
    assert.match(row.error, /^Interrupted: Visionary started at 2026-11-15T02:45:00\.000Z/);
    assert.ok(row.error.includes(entry.prior_status), 'error names the prior status');
    assert.ok(row.error.includes('workdir'), 'error points at surviving files');
  }

  const done = stmts.getRunById.get(doneId);
  const failed = stmts.getRunById.get(failedId);
  assert.equal(done.status, 'completed', 'completed row untouched');
  assert.equal(failed.status, 'failed', 'failed row untouched');
  assert.equal(done.error, null);
});

test('boot reconciliation is idempotent — a second pass finds nothing live', () => {
  const result = reconcileOrphanedRuns({ stmts, source: 'boot' });
  assert.equal(result.count, 0);
  assert.deepEqual(result.reconciled, []);
  assert.equal(stmts.getOrphanedRuns.all().length, 0);
});

test('shutdown reconciliation only touches the run ids the dying process owned', () => {
  seedTask(201, 'Reconcile task B');
  seedTask(202, 'Reconcile task C');
  seedTask(203, 'Reconcile task D');
  const ownedA = seedRun({ status: 'running', taskId: 201, ageHours: 0 });
  const ownedB = seedRun({ status: 'running', taskId: 202, ageHours: 0 });
  const notOwned = seedRun({ status: 'running', taskId: 203, ageHours: 0 });
  const alreadyDone = seedRun({ status: 'completed', ageHours: 0 });

  const result = reconcileOrphanedRuns({
    stmts,
    runIds: [ownedA, ownedB, alreadyDone, 999999],
    source: 'shutdown',
    signal: 'SIGTERM',
    now: '2026-11-15T03:10:00.000Z'
  });

  assert.equal(result.count, 2, 'only live owned ids are reconciled');
  assert.deepEqual(result.reconciled.map((r) => r.id).sort((a, b) => a - b), [ownedA, ownedB].sort((a, b) => a - b));
  assert.ok(result.skipped.some((s) => s.id === alreadyDone && s.reason === 'not_live'));
  assert.equal(result.skipped.filter((s) => s.id === 999999).length, 0, 'unknown ids are ignored, not reported');

  for (const entry of result.reconciled) {
    const row = stmts.getRunById.get(entry.id);
    assert.equal(row.status, 'timeout');
    assert.match(row.error, /^Interrupted: Visionary shut down \(SIGTERM\) at 2026-11-15T03:10:00\.000Z/);
    assert.ok(row.error.includes('harness child was terminated'));
  }

  const survivor = stmts.getRunById.get(notOwned);
  assert.equal(survivor.status, 'running', 'a run owned by another process is left live');
  assert.equal(stmts.getRunById.get(alreadyDone).status, 'completed');
});

test('reconciliation rejects a statements object without the required prepared statements', () => {
  assert.throws(() => reconcileOrphanedRuns({}), /getOrphanedRuns/);
  assert.throws(() => reconcileOrphanedRuns({ stmts: { getOrphanedRuns: {}, markRunInterrupted: {} }, runIds: [1] }), /getRunById/);
});

test('interrupt messages are explicit about source, time, and surviving files', () => {
  assert.match(buildInterruptMessage('boot', '2026-11-15T00:00:00.000Z', 'running'), /previous server process/);
  assert.match(buildInterruptMessage('shutdown', '2026-11-15T00:00:00.000Z', 'pending', 'SIGINT'), /shut down \(SIGINT\)/);
  assert.deepEqual(LIVE_RUN_STATUSES, ['pending', 'running']);
});

test('summarizeReconciliation names the reconciled runs and their source', () => {
  const summary = summarizeReconciliation({
    source: 'boot',
    count: 2,
    reconciled: [{ id: 4, agent_id: 'argus' }, { id: 5, agent_id: 'forge' }]
  });
  assert.ok(summary.includes('2 interrupted run row(s)'));
  assert.ok(summary.includes('#4 argus'));
  assert.ok(summary.includes('#5 forge'));
  assert.equal(summarizeReconciliation({ count: 0 }), 'No orphaned run rows to reconcile.');
});
