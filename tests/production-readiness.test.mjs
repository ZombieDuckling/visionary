import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const readiness = require('../src/production-readiness');

test('production readiness classifies deterministic, LLM-call, and agentic workflows', () => {
  assert.equal(readiness.classifyWorkflow({ description: 'Run a nightly script with fixed SQL rules' }), 'deterministic');
  assert.equal(readiness.classifyWorkflow({ description: 'Summarize new notes into a short briefing' }), 'llm_call');
  assert.equal(readiness.classifyWorkflow({ description: 'Choose tools, edit files, retry failures, then dispatch a worker' }), 'agentic');
  assert.equal(readiness.classifyWorkflow({ type: 'one-shot-llm' }), 'llm_call');
});

test('agentic high-risk workflows require governance, cost, security, and autonomy gates', () => {
  const review = readiness.readinessReview({
    description: 'Agent can call APIs and edit workspace files for customers',
    risk: 'high',
    gates_done: ['owner', 'rollback', 'audit_log'],
  });

  assert.equal(review.ready, false);
  assert.equal(review.stage, 'prototype');
  assert.equal(review.workflow_type, 'agentic');
  assert.equal(review.risk_level, 'high');

  const missingIds = review.missing_gates.map((g) => g.id);
  for (const required of [
    'monitoring',
    'cost_budget',
    'secret_boundary',
    'data_boundary',
    'tool_allowlist',
    'risk_envelope',
    'human_review',
    'retry_policy',
    'access_control',
    'incident_path',
  ]) {
    assert.ok(missingIds.includes(required), `missing gates should include ${required}`);
  }
});

test('workflow becomes a production candidate only when every required gate is complete', () => {
  const { gates } = readiness.requiredGatesFor({ type: 'agentic', risk: 'high' });
  const review = readiness.readinessReview({
    type: 'agentic',
    risk: 'high',
    gates_done: gates.map((g) => g.id),
  });

  assert.equal(review.ready, true);
  assert.equal(review.stage, 'production_candidate');
  assert.deepEqual(review.missing_gates, []);
});
