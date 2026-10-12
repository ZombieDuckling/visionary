import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { summarizeCostBaseline } = require('../src/cost-baseline.js');

test('summarizeCostBaseline compares AI spend to explicit human baseline', () => {
  const summary = summarizeCostBaseline([
    { agent_id: 'forge', status: 'completed', estimated_cost_usd: 0.05, input_tokens: 1000, output_tokens: 250 },
    { agent_id: 'forge', status: 'completed', estimated_cost_usd: 0.03, input_tokens: 800, output_tokens: 120 },
    { agent_id: 'scout', status: 'failed', estimated_cost_usd: 0.02 }
  ], {
    human_minutes_per_completed_run: 30,
    human_hourly_rate_usd: 60,
    window_label: 'test window'
  });

  assert.equal(summary.window_label, 'test window');
  assert.equal(summary.total_runs, 3);
  assert.equal(summary.completed_runs, 2);
  assert.equal(summary.ai_cost_usd, 0.1);
  assert.equal(summary.human_baseline_usd, 60);
  assert.equal(summary.net_delta_usd, 59.9);
  assert.equal(summary.cost_per_completed_run_usd, 0.05);
  assert.equal(summary.decision_signal, 'ai_cheaper_than_baseline');
  assert.deepEqual(summary.baseline_assumptions, {
    human_minutes_per_completed_run: 30,
    human_hourly_rate_usd: 60
  });
});

test('summarizeCostBaseline reports telemetry quality and top agents', () => {
  const summary = summarizeCostBaseline([
    { agent_id: 'argus', status: 'completed', estimated_cost_usd: 0.2, input_tokens: 10 },
    { agent_id: 'argus', status: 'completed', estimated_cost_usd: 0.1 },
    { agent_id: 'sentinel', status: 'timeout', estimated_cost_usd: null }
  ]);

  assert.equal(summary.telemetry_quality.token_reporting_runs, 1);
  assert.equal(summary.telemetry_quality.estimated_cost_runs, 1);
  assert.equal(summary.telemetry_quality.missing_cost_runs, 1);
  assert.equal(summary.by_agent[0].agent_id, 'argus');
  assert.equal(summary.by_agent[0].runs, 2);
  assert.equal(summary.by_agent[0].completed_runs, 2);
});

test('summarizeCostBaseline handles empty input safely', () => {
  const summary = summarizeCostBaseline(null);
  assert.equal(summary.total_runs, 0);
  assert.equal(summary.completed_runs, 0);
  assert.equal(summary.ai_cost_usd, 0);
  assert.equal(summary.human_baseline_usd, 0);
  assert.equal(summary.decision_signal, 'no_completed_runs');
});

test('summarizeCostBaseline flags repeated large-context rereads', () => {
  const sourceHeavyPrompt = 'Review this pasted source bundle and produce the next action.';
  const summary = summarizeCostBaseline([
    { id: 1, agent_id: 'forge', status: 'completed', input_tokens: 9000, estimated_cost_usd: 0.1, message: sourceHeavyPrompt },
    { id: 2, agent_id: 'scout', status: 'completed', input_tokens: 8500, estimated_cost_usd: 0.1, message: '  review this pasted source bundle\n and produce the next action. ' },
    { id: 3, agent_id: 'forge', status: 'completed', input_tokens: 1200, estimated_cost_usd: 0.01, message: sourceHeavyPrompt },
    { id: 4, agent_id: 'reviewer', status: 'completed', input_tokens: 9000, estimated_cost_usd: 0.1, message: 'Different large prompt' }
  ], { large_context_token_threshold: 8000 });

  assert.equal(summary.context_reread_risk.large_context_runs, 3);
  assert.equal(summary.context_reread_risk.repeated_context_groups, 1);
  assert.equal(summary.context_reread_risk.repeated_context_runs, 2);
  assert.equal(summary.context_reread_risk.largest_repeated_input_tokens, 17500);
  assert.match(summary.context_reread_risk.recommendation, /Distill repeated source/);
});
