import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyCapabilityAssumptionReview,
  capabilityAssumptionReviewPromptBlock,
  appendCapabilityAssumptionReviewPrompt
} = require('../src/capability-assumption-review.js');

test('classifyCapabilityAssumptionReview ignores empty and ordinary operational prompts', () => {
  assert.equal(classifyCapabilityAssumptionReview('').applies, false);
  const result = classifyCapabilityAssumptionReview('Restart the dashboard server and check the logs');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no capability-limitation signal');
  assert.equal(capabilityAssumptionReviewPromptBlock('Restart the dashboard server and check the logs'), '');
});

test('classifyCapabilityAssumptionReview ignores a bare capability claim with no workflow framing', () => {
  const result = classifyCapabilityAssumptionReview('The model cannot count the letters in a word');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'capability claim stated without a workflow/decision framing');
});

test('classifyCapabilityAssumptionReview ignores a limitation with no AI subject', () => {
  const result = classifyCapabilityAssumptionReview('The printer cannot handle envelopes so we use labels');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'limitation stated without an AI/model/tool subject');
});

test('classifyCapabilityAssumptionReview fires on keeping work manual because AI is unreliable', () => {
  const result = classifyCapabilityAssumptionReview('AI isn\'t reliable enough for legal review so we keep a human in the loop');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'capability-claim-check');
  assert.ok(result.signals.limitation >= 1);
  assert.ok(result.signals.subject >= 1);
  assert.ok(result.signals.decision >= 1);
});

test('classifyCapabilityAssumptionReview fires a full review on a hard, repeated limitation claim', () => {
  const result = classifyCapabilityAssumptionReview('LLMs cannot reason about our data and agents still hallucinate, so we build a script for every step');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'capability-assumption-review');
});

test('classifyCapabilityAssumptionReview fires on routing around a claimed model limitation', () => {
  const result = classifyCapabilityAssumptionReview('The model can\'t handle long documents so we split everything before dispatching');
  assert.equal(result.applies, true);
});

test('classifyCapabilityAssumptionReview steps back when the operator already framed the claim as dated', () => {
  const message = 'That dated assumption that the model can\'t write our copy no longer holds, so we re-test on the new model release';
  const result = classifyCapabilityAssumptionReview(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'operator already framed the claim as dated and re-testable');
});

test('capabilityAssumptionReviewPromptBlock asks for assumption, expiry, goal-vs-tactic, re-test trigger and verdict', () => {
  const block = capabilityAssumptionReviewPromptBlock('AI isn\'t reliable enough for legal review so we keep a human in the loop');
  assert.match(block, /CAPABILITY-ASSUMPTION REVIEW/);
  assert.match(block, /Name the assumption/);
  assert.match(block, /may have expired/);
  assert.match(block, /Separate the durable goal from the dated tactic/);
  assert.match(block, /re-test trigger/);
  assert.match(block, /Re-test cheaply/);
  assert.match(block, /Verdict/);
});

test('appendCapabilityAssumptionReviewPrompt preserves the original request first', () => {
  const message = 'The model can\'t handle long documents so we split everything before dispatching';
  const augmented = appendCapabilityAssumptionReviewPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[CAPABILITY-ASSUMPTION REVIEW\]/);
});
