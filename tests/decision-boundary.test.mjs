import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyDecisionBoundary,
  decisionBoundaryPromptBlock,
  appendDecisionBoundaryPrompt
} = require('../src/decision-boundary.js');

test('classifyDecisionBoundary ignores ordinary work', () => {
  const result = classifyDecisionBoundary('Move the task to review and update the weekly note');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no AI/workflow signal');
  assert.equal(decisionBoundaryPromptBlock('Move the task to review and update the weekly note'), '');
});

test('classifyDecisionBoundary detects capability versus ethics work', () => {
  const result = classifyDecisionBoundary('Assess whether the AI agent can rank customer requests safely without bias or consent problems');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'capability-vs-ethics-boundary');
  assert.ok(result.score >= 12);
  assert.ok(result.signals.ai >= 2);
  assert.ok(result.signals.capability >= 2);
  assert.ok(result.signals.ethics >= 3);
});

test('classifyDecisionBoundary detects deployment responsibility boundaries', () => {
  const result = classifyDecisionBoundary('Deploy an automated model decision workflow to production with human review, rollout owner, monitoring, and escalation support');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'deployment-responsibility-boundary');
  assert.ok(result.signals.deployment >= 6);
});

test('decisionBoundaryPromptBlock names evidence, ethics, deployment, human boundary, and verification', () => {
  const block = decisionBoundaryPromptBlock('Launch an AI triage agent that can decide support escalation risk');
  assert.match(block, /DECISION BOUNDARY CHECK/);
  assert.match(block, /Capability evidence/);
  assert.match(block, /Ethics and risk judgment/);
  assert.match(block, /Deployment responsibility/);
  assert.match(block, /Human boundary/);
  assert.match(block, /Verification/);
});

test('appendDecisionBoundaryPrompt preserves original request first', () => {
  const message = 'Evaluate whether an AI model can automate risky customer decisions with human review';
  const augmented = appendDecisionBoundaryPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[DECISION BOUNDARY CHECK\]/);
});
