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

test('truth deck validator requires representative cases with explicit expected behavior', () => {
  const incomplete = readiness.validateTruthDeck({
    goal: 'Protect daily briefing quality while changing models',
    cases: [{ name: 'thin case', input: 'new notes' }],
  });

  assert.equal(incomplete.ready, false);
  assert.equal(incomplete.stage, 'truth_deck_incomplete');
  assert.ok(incomplete.missing_fields.includes('complete_cases'));
  assert.deepEqual(incomplete.case_results[0].missing_fields, [
    'expected_output',
    'must_include',
    'must_avoid',
    'quality_threshold',
  ]);
});

test('complete truth deck satisfies the evals readiness gate without stringly flags', () => {
  const allButEvals = readiness.requiredGatesFor({ type: 'llm_call', risk: 'medium' })
    .gates.map((g) => g.id)
    .filter((id) => id !== 'evals');

  const review = readiness.readinessReview({
    type: 'llm_call',
    risk: 'medium',
    gates_done: allButEvals,
    truth_deck: {
      goal: 'Protect the quality, cost, and latency of task summary rewrites',
      cases: [{
        name: 'Noisy run log to concise operator summary',
        input: 'raw dispatch log with errors, retries, and final artifact list',
        expected_output: 'short status summary with result, evidence, and next action',
        must_include: ['verification command', 'artifact path', 'commit status'],
        must_avoid: ['invented outputs', 'raw secret values'],
        quality_threshold: 'Human operator can decide whether to trust the run without opening the full log',
        latency_target: '< 10s',
        cost_target: '< $0.02',
      }],
    },
  });

  assert.equal(review.ready, true);
  assert.equal(review.stage, 'production_candidate');
  assert.equal(review.truth_deck.ready, true);
  assert.deepEqual(review.missing_gates, []);
});

test('vibe-coded launch audit requires route, auth, secret, artifact, provider, and threat-model review', () => {
  const audit = readiness.vibeCodedAudit({
    gates_done: ['current_secret_scan', 'public_route_map'],
    limitations: ['Deployment console not accessible from this machine'],
  });

  assert.equal(audit.ready, false);
  assert.equal(audit.stage, 'needs_human_security_review');
  assert.deepEqual(audit.limitations, ['Deployment console not accessible from this machine']);

  const missingIds = audit.missing_gates.map((g) => g.id);
  for (const required of [
    'history_secret_scan',
    'managed_auth_review',
    'generated_artifact_review',
    'provider_boundary_review',
    'human_threat_model',
  ]) {
    assert.ok(missingIds.includes(required), `missing audit gates should include ${required}`);
  }
});

test('vibe-coded launch audit completes only when all gates are done and no limitations remain', () => {
  const audit = readiness.vibeCodedAudit({
    gates_done: readiness.VIBE_CODED_AUDIT_GATES.map((g) => g.id),
  });

  assert.equal(audit.ready, true);
  assert.equal(audit.stage, 'launch_review_complete');
  assert.deepEqual(audit.missing_gates, []);
  assert.deepEqual(audit.limitations, []);
});
