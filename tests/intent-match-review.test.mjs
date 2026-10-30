import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyIntentMatchReview,
  intentMatchReviewPromptBlock,
  appendIntentMatchReviewPrompt
} = require('../src/intent-match-review.js');

test('classifyIntentMatchReview ignores empty and unrelated prompts', () => {
  assert.equal(classifyIntentMatchReview('').applies, false);
  const result = classifyIntentMatchReview('Summarize the meeting notes and send a digest');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no review/decision language');
  assert.equal(intentMatchReviewPromptBlock('Summarize the meeting notes and send a digest'), '');
});

test('classifyIntentMatchReview needs a produced-work object, not just a decision', () => {
  const result = classifyIntentMatchReview('Give me the verdict on the market');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'review/decision without a produced-work object');
});

test('classifyIntentMatchReview does not match tokens as substrings', () => {
  // 'pr' must not match inside 'apparent', 'api' must not match 'aping'.
  const result = classifyIntentMatchReview('I decide the appointment is apparent');
  assert.equal(result.applies, false);
});

test('classifyIntentMatchReview flags approving a produced PR', () => {
  const result = classifyIntentMatchReview('Approve the PR if it works');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'implied-intent-match');
  assert.ok(result.signals.reviewDecision >= 1);
  assert.ok(result.signals.workObject >= 1);
});

test('classifyIntentMatchReview flags the explicit right-problem framing', () => {
  const result = classifyIntentMatchReview('Did it solve the right problem, let me judge the feature');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'explicit-intent-match');
});

test('classifyIntentMatchReview flags assessing an AI-built dashboard', () => {
  const result = classifyIntentMatchReview('Assess the dashboard the agent built and decide');
  assert.equal(result.applies, true);
  assert.ok(result.signals.workObject >= 1);
});

test('classifyIntentMatchReview does not nag when the intent-match frame is already set', () => {
  const message = 'Verify against intent and matches the intent — embedded decision, judgment layer';
  const result = classifyIntentMatchReview(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'intent-match frame already established');
});

test('intentMatchReviewPromptBlock names the intent-match parts', () => {
  const block = intentMatchReviewPromptBlock('Approve the build if it is correct');
  assert.match(block, /INTENT-MATCH REVIEW CHECK/);
  assert.match(block, /Intent criterion:/);
  assert.match(block, /Right-problem question:/);
  assert.match(block, /Embedded judgment:/);
  assert.match(block, /Diagnose the problem definition first:/);
  assert.match(block, /Verdict:/);
});

test('appendIntentMatchReviewPrompt preserves the original request first and is a no-op otherwise', () => {
  const message = 'Accept the refactor once you decide';
  const augmented = appendIntentMatchReviewPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[INTENT-MATCH REVIEW CHECK\]/);

  const unrelated = 'Rename the column header';
  assert.equal(appendIntentMatchReviewPrompt(unrelated), unrelated);
});
