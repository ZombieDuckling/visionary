// Unit tests for src/project-cost-summary.js — cost per completed outcome with
// usage-provenance disclosure.
//
// The summary exists because Visionary stored token/cost numbers without
// recording whether they were harness-reported or deterministic estimates, so
// the UI presented both identically. These tests pin the honesty posture: spend
// totals include failed runs, estimates are labeled, unlabeled legacy rows are
// reported as unknown, and cost-per-outcome is withheld when nothing is done.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { summarizeProjectCost, RUN_CAP } = require('../src/project-cost-summary.js');

function run(overrides) {
  return Object.assign({
    run_id: 1,
    task_id: 1,
    agent_id: 'forge',
    status: 'completed',
    input_tokens: null,
    output_tokens: null,
    estimated_cost_usd: null,
    usage_source: null,
    usage_estimated: null,
    created_at: '2026-11-15 10:00:00'
  }, overrides || {});
}

function task(status) {
  return { id: 1, status: status, title: 'task' };
}

test('reported usage yields cost per completed outcome with reported basis', () => {
  const summary = summarizeProjectCost({
    runs: [
      run({ status: 'completed', input_tokens: 1000, output_tokens: 500, estimated_cost_usd: 0.5, usage_source: 'reported', usage_estimated: 0 }),
      run({ status: 'failed', input_tokens: 200, output_tokens: 100, estimated_cost_usd: 0.25, usage_source: 'reported', usage_estimated: 0 })
    ],
    tasks: [task('done'), task('todo')]
  });

  assert.equal(summary.ok, true);
  assert.equal(summary.runs.total, 2);
  assert.equal(summary.runs.completed, 1);
  assert.equal(summary.runs.failed, 1);
  assert.equal(summary.cost.total_usd, 0.75);
  assert.equal(summary.cost.reported_usd, 0.75);
  assert.equal(summary.cost.reported_runs, 2);
  assert.equal(summary.basis, 'reported');
  assert.equal(summary.per_outcome.outcomes, 1);
  assert.equal(summary.per_outcome.cost_usd, 0.75);
  assert.equal(summary.per_outcome.tokens, 1800);
  assert.equal(summary.per_outcome.basis, 'reported');
  assert.ok(!summary.warnings.some((w) => w.code === 'all_costs_estimated'));
  assert.match(summary.disclosure, /harness-reported/);
});

test('estimated-only usage is labeled and warned, never presented as observed spend', () => {
  const summary = summarizeProjectCost({
    runs: [run({ status: 'completed', input_tokens: 800, output_tokens: 200, estimated_cost_usd: 0.02, usage_source: 'estimated', usage_estimated: 1 })],
    tasks: [task('done')]
  });

  assert.equal(summary.basis, 'estimated');
  assert.equal(summary.cost.estimated_usd, 0.02);
  assert.equal(summary.cost.reported_usd, 0);
  assert.ok(summary.warnings.some((w) => w.code === 'all_costs_estimated'));
  assert.match(summary.disclosure, /estimated/);
});

test('legacy rows without provenance are reported as unknown basis', () => {
  const summary = summarizeProjectCost({
    runs: [
      run({ status: 'completed', input_tokens: 100, output_tokens: 50, estimated_cost_usd: 0.01 }),
      run({ status: 'completed', input_tokens: 300, output_tokens: 100, estimated_cost_usd: 0.03, usage_source: 'reported', usage_estimated: 0 })
    ],
    tasks: [task('done')]
  });

  assert.equal(summary.cost.unknown_runs, 1);
  assert.equal(summary.cost.reported_runs, 1);
  assert.equal(summary.cost.unknown_usd, 0.01);
  assert.equal(summary.basis, 'mixed');
  assert.ok(summary.warnings.some((w) => w.code === 'unlabeled_basis'));
});

test('mixed reported and estimated provenance yields mixed basis', () => {
  const summary = summarizeProjectCost({
    runs: [
      run({ input_tokens: 100, output_tokens: 10, estimated_cost_usd: 0.01, usage_source: 'reported', usage_estimated: 0 }),
      run({ input_tokens: 200, output_tokens: 20, estimated_cost_usd: 0.02, usage_source: 'estimated', usage_estimated: 1 })
    ],
    tasks: [task('done')]
  });
  assert.equal(summary.basis, 'mixed');
  assert.equal(summary.per_outcome.basis, 'mixed');
});

test('cost per completed outcome is withheld when no task is done', () => {
  const summary = summarizeProjectCost({
    runs: [run({ status: 'completed', input_tokens: 100, output_tokens: 10, estimated_cost_usd: 0.05, usage_source: 'reported', usage_estimated: 0 })],
    tasks: [task('review'), task('todo')]
  });

  assert.equal(summary.per_outcome.cost_usd, null);
  assert.equal(summary.per_outcome.tokens, null);
  assert.equal(summary.per_outcome.outcomes, 0);
  assert.ok(summary.warnings.some((w) => w.code === 'no_completed_outcome'));
});

test('empty project reports no runs without inventing numbers', () => {
  const summary = summarizeProjectCost({ runs: [], tasks: [] });
  assert.equal(summary.runs.total, 0);
  assert.equal(summary.cost.total_usd, 0);
  assert.equal(summary.per_outcome.cost_usd, null);
  assert.ok(summary.warnings.some((w) => w.code === 'no_runs'));
  assert.equal(summary.disclosure.indexOf('No usage was recorded'), 0);
});

test('runs without telemetry are counted but do not fabricate cost', () => {
  const summary = summarizeProjectCost({
    runs: [run({ status: 'completed' }), run({ status: 'failed' })],
    tasks: [task('done')]
  });
  assert.equal(summary.runs.total, 2);
  assert.equal(summary.runs.with_usage, 0);
  assert.equal(summary.runs.without_usage, 2);
  assert.equal(summary.cost.total_usd, 0);
  assert.ok(summary.warnings.some((w) => w.code === 'no_usage_recorded'));
});

test('malformed and negative values are skipped, never thrown', () => {
  const summary = summarizeProjectCost({
    runs: [
      null,
      'nope',
      run({ input_tokens: -5, output_tokens: 10, estimated_cost_usd: 0.01, usage_source: 'reported', usage_estimated: 0 }),
      run({ input_tokens: 'abc', output_tokens: '20', estimated_cost_usd: '0.02', usage_source: 'reported', usage_estimated: 0 })
    ],
    tasks: [task('done')]
  });

  assert.equal(summary.ok, true);
  assert.equal(summary.skipped.malformed_runs, 2);
  assert.equal(summary.runs.total, 2);
  assert.equal(summary.cost.total_usd, 0.03);
  // Negative input is discarded, the valid output token count survives.
  assert.equal(summary.usage.output_tokens, 30);
  assert.equal(summary.usage.input_tokens, 0);
});

test('telemetry `explicit` source is classified as reported', () => {
  const summary = summarizeProjectCost({
    runs: [run({ input_tokens: 100, output_tokens: 10, estimated_cost_usd: 0.01, usage_source: 'explicit', usage_estimated: 0 })],
    tasks: [task('done')]
  });
  assert.equal(summary.cost.reported_runs, 1);
  assert.equal(summary.basis, 'reported');
});

test('truncation at the run cap is disclosed', () => {
  const runs = [];
  for (let i = 0; i < RUN_CAP + 5; i++) {
    runs.push(run({ input_tokens: 10, output_tokens: 5, estimated_cost_usd: 0.001, usage_source: 'estimated', usage_estimated: 1 }));
  }
  const summary = summarizeProjectCost({ runs: runs, tasks: [task('done')] });
  assert.equal(summary.runs.total, RUN_CAP);
  assert.ok(summary.warnings.some((w) => w.code === 'truncated'));
});
