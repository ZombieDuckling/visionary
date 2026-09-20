import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyReplicabilityCheck,
  replicabilityCheckPromptBlock,
  appendReplicabilityCheckPrompt
} = require('../src/replicability-check.js');

test('classifyReplicabilityCheck ignores ordinary ideation', () => {
  const result = classifyReplicabilityCheck('Brainstorm three homepage positioning angles for review');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no delivery/ops signal');
  assert.equal(replicabilityCheckPromptBlock('Brainstorm three homepage positioning angles for review'), '');
});

test('classifyReplicabilityCheck detects repeatable runbook work', () => {
  const result = classifyReplicabilityCheck('Deploy the cron automation and leave a repeatable runbook with fallback steps');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'repeatable-runbook');
  assert.ok(result.score >= 10);
  assert.ok(result.signals.delivery >= 2);
  assert.ok(result.signals.replication >= 2);
});

test('classifyReplicabilityCheck detects evidence-backed handoffs', () => {
  const result = classifyReplicabilityCheck('Ship the workflow, run smoke tests, save logs, list commands, and verify the artifact path');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'evidence-backed-handoff');
  assert.ok(result.signals.proof >= 5);
});

test('replicabilityCheckPromptBlock names inputs, repeatable path, fallback, and proof', () => {
  const block = replicabilityCheckPromptBlock('Set up the production automation so it can be reproduced with backup commands');
  assert.match(block, /REPLICABILITY CHECK/);
  assert.match(block, /Inputs and environment/);
  assert.match(block, /Repeatable path/);
  assert.match(block, /Redundancy and fallback/);
  assert.match(block, /Proof/);
});

test('appendReplicabilityCheckPrompt preserves original request first', () => {
  const message = 'Launch the scheduled pipeline, verify logs, and document the rerun commands';
  const augmented = appendReplicabilityCheckPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[REPLICABILITY CHECK\]/);
});
