import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyClassifierGate,
  classifierGatePromptBlock,
  appendClassifierGatePrompt
} = require('../src/classifier-gate.js');

test('classifyClassifierGate ignores direct one-off writing tasks', () => {
  const result = classifyClassifierGate('Write a short project update for the dashboard');
  assert.equal(result.applies, false);
  assert.equal(classifierGatePromptBlock('Write a short project update for the dashboard'), '');
});

test('classifyClassifierGate detects repeated routing and readiness decisions', () => {
  const result = classifyClassifierGate('For every intake item in the queue, classify the ticket, score readiness, and route it to the right agent');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'routing-gate');
  assert.ok(result.score >= 10);
  assert.ok(result.signals.classifier >= 3);
  assert.ok(result.signals.repeated >= 2);
});

test('classifierGatePromptBlock requires thresholds and deterministic exclusions', () => {
  const block = classifierGatePromptBlock('Use an AI rubric to approve or reject each backlog item with confidence thresholds');
  assert.match(block, /CLASSIFIER-GATE CHECK/);
  assert.match(block, /Gate scope/);
  assert.match(block, /Allowed outputs/);
  assert.match(block, /Threshold policy/);
  assert.match(block, /Deterministic exclusions/);
  assert.match(block, /Override\/eval loop/);
});

test('appendClassifierGatePrompt preserves original prompt and appends bounded gate', () => {
  const augmented = appendClassifierGatePrompt('Batch classify leads, assign labels, and triage each one to the right workflow');
  assert.ok(augmented.startsWith('Batch classify leads'));
  assert.match(augmented, /\[CLASSIFIER-GATE CHECK\]/);
});

test('classifyClassifierGate does not nudge exact checks as fuzzy judgment', () => {
  const result = classifyClassifierGate('Run a checksum and file exists validation for each artifact');
  assert.equal(result.applies, false);
  assert.match(result.reason, /deterministic fact|no bounded classifier/);
});
