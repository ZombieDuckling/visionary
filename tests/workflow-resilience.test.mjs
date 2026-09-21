import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyWorkflowResilience,
  workflowResiliencePromptBlock,
  appendWorkflowResiliencePrompt
} = require('../src/workflow-resilience.js');

test('classifyWorkflowResilience ignores ordinary non-AI work', () => {
  const result = classifyWorkflowResilience('Write a short project update for the client');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no AI/provider dependency signal');
  assert.equal(workflowResiliencePromptBlock('Write a short project update for the client'), '');
});

test('classifyWorkflowResilience detects provider fallback work', () => {
  const result = classifyWorkflowResilience('Set up agent failover when Claude hits quota or the provider is down');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'provider-fallback');
  assert.ok(result.score >= 12);
  assert.ok(result.signals.dependency >= 2);
  assert.ok(result.signals.failure >= 2);
});

test('classifyWorkflowResilience detects portable-state resilience work', () => {
  const result = classifyWorkflowResilience('Design an AI workflow with manifests, artifacts, logs, schemas, tests, and handoff state so another model can resume');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'portable-state');
  assert.ok(result.signals.continuity >= 5);
});

test('workflowResiliencePromptBlock names state, provider fallback, manual fallback, contract, verification, and degradation', () => {
  const block = workflowResiliencePromptBlock('Build the LLM automation with fallback, backup provider, local recovery, and verification tests');
  assert.match(block, /WORKFLOW RESILIENCE CHECK/);
  assert.match(block, /Portable state/);
  assert.match(block, /Provider fallback/);
  assert.match(block, /Local\/manual fallback/);
  assert.match(block, /Contract boundary/);
  assert.match(block, /Verification and degradation/);
});

test('appendWorkflowResiliencePrompt preserves original request first', () => {
  const message = 'Deploy the AI dispatch workflow with model fallback and safe degradation if every provider fails';
  const augmented = appendWorkflowResiliencePrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[WORKFLOW RESILIENCE CHECK\]/);
});
