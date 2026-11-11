import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pipeline = require('../src/prompt-pipeline.js');

function fakeEntry(id, score, applies, blockText) {
  return {
    id,
    classify: function () { return { applies, score, reason: applies ? 'match' : 'no match' }; },
    block: function () { return applies ? blockText : ''; }
  };
}

test('classifies against the original message only — injected blocks never re-trigger nudges', () => {
  const message = 'Fix the login bug in server.js';
  const plan = pipeline.planNudges(message);
  const ids = plan.meta.applied.map(function (a) { return a.id; });
  assert.deepEqual(ids, ['failure-study-loop']);
  assert.ok(plan.meta.nudge_chars > 0 && plan.meta.nudge_chars < 1000);
  assert.ok(plan.meta.prompt_chars < 1000);
  assert.equal(plan.text.startsWith(message), true);
});

test('a short request no longer inflates into a 40-block prompt', () => {
  const plan = pipeline.planNudges('Fix the login bug in server.js');
  assert.ok(plan.meta.applied.length <= pipeline.DEFAULT_MAX_NUDGES);
  assert.ok(plan.meta.prompt_chars < 2000, 'prompt stayed under 2000 chars');
});

test('ranks by classifier score and drops the tail deterministically', () => {
  const registry = [
    fakeEntry('low', 3, true, '[LOW]'.padEnd(40, '.')),
    fakeEntry('high', 9, true, '[HIGH]'.padEnd(40, '.')),
    fakeEntry('mid', 6, true, '[MID]'.padEnd(40, '.')),
    fakeEntry('off', 0, false, '')
  ];
  const plan = pipeline.planNudges('anything', { registry, limits: { budget_chars: 500, max_nudges: 2 } });
  assert.deepEqual(plan.meta.applied.map(function (a) { return a.id; }), ['high', 'mid']);
  assert.deepEqual(plan.meta.dropped.map(function (a) { return a.id; }), ['low']);
  const again = pipeline.planNudges('anything', { registry, limits: { budget_chars: 500, max_nudges: 2 } });
  assert.deepEqual(again.meta.applied, plan.meta.applied);
});

test('budget drops blocks that would overflow instead of truncating them mid-block', () => {
  const registry = [
    fakeEntry('a', 9, true, 'A'.repeat(100)),
    fakeEntry('b', 8, true, 'B'.repeat(100)),
    fakeEntry('c', 7, true, 'C'.repeat(100))
  ];
  const plan = pipeline.planNudges('x', { registry, limits: { budget_chars: 250, max_nudges: 0 } });
  assert.deepEqual(plan.meta.applied.map(function (x) { return x.id; }), ['a', 'b']);
  assert.deepEqual(plan.meta.dropped.map(function (x) { return x.id; }), ['c']);
  assert.ok(plan.meta.nudge_chars <= 250);
});

test('budget of zero disables the cap', () => {
  const registry = [
    fakeEntry('a', 9, true, 'A'.repeat(100)),
    fakeEntry('b', 8, true, 'B'.repeat(100))
  ];
  const plan = pipeline.planNudges('x', { registry, limits: { budget_chars: 0, max_nudges: 0 } });
  assert.equal(plan.meta.applied.length, 2);
  assert.equal(plan.meta.dropped.length, 0);
});

test('a single over-budget top signal is still injected rather than leaving a bare prompt', () => {
  const registry = [fakeEntry('big', 9, true, 'X'.repeat(900))];
  const plan = pipeline.planNudges('x', { registry, limits: { budget_chars: 500, max_nudges: 4 } });
  assert.deepEqual(plan.meta.applied.map(function (a) { return a.id; }), ['big']);
  assert.equal(plan.text, 'x\n\n' + 'X'.repeat(900));
});

test('no matching signals leaves the operator message untouched', () => {
  const registry = [fakeEntry('off', 0, false, '')];
  const plan = pipeline.planNudges('Restart the server', { registry, limits: { budget_chars: 6000, max_nudges: 4 } });
  assert.equal(plan.text, 'Restart the server');
  assert.equal(plan.meta.nudge_chars, 0);
  assert.deepEqual(plan.meta.applied, []);
});

test('a broken nudge module is skipped and reported, never fatal to dispatch', () => {
  const registry = [
    { id: 'broken', classify: function () { throw new Error('boom'); }, block: function () { return ''; } },
    fakeEntry('good', 5, true, '[GOOD]')
  ];
  const plan = pipeline.planNudges('x', { registry, limits: { budget_chars: 6000, max_nudges: 4 } });
  assert.deepEqual(plan.meta.applied.map(function (a) { return a.id; }), ['good']);
  assert.equal(plan.meta.errors.length, 1);
  assert.equal(plan.meta.errors[0].id, 'broken');
});

test('env limits resolve with defaults and tolerate garbage values', () => {
  assert.deepEqual(pipeline.resolveLimits({}), { budget_chars: 6000, max_nudges: 4 });
  assert.deepEqual(pipeline.resolveLimits({ VISIONARY_NUDGE_BUDGET_CHARS: '12000', VISIONARY_NUDGE_MAX: '2' }), { budget_chars: 12000, max_nudges: 2 });
  assert.deepEqual(pipeline.resolveLimits({ VISIONARY_NUDGE_BUDGET_CHARS: 'nonsense' }), { budget_chars: 6000, max_nudges: 4 });
  assert.deepEqual(pipeline.resolveLimits({ VISIONARY_NUDGE_BUDGET_CHARS: '0' }), { budget_chars: 0, max_nudges: 4 });
});

test('real registry stays coherent: every nudge module exports a classify/block pair', () => {
  const registry = pipeline.getRegistry();
  assert.equal(registry.length, pipeline.NUDGE_MODULES.length);
  for (const entry of registry) {
    assert.equal(typeof entry.classify, 'function');
    assert.equal(typeof entry.block, 'function');
  }
});

test('secret-rotation request still gets its secret-isolation block', () => {
  const plan = pipeline.planNudges('Rotate the API key, redeploy, and verify no secret leaked into the logs');
  const ids = plan.meta.applied.map(function (a) { return a.id; });
  assert.ok(ids.includes('secret-isolation-review'));
  assert.ok(plan.meta.prompt_chars <= plan.meta.budget_chars);
});
