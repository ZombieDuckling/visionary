import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyReviewDebt,
  reviewDebtPromptBlock,
  appendReviewDebtPrompt
} = require('../src/review-debt.js');

test('classifyReviewDebt ignores empty and small operational prompts', () => {
  assert.equal(classifyReviewDebt('').applies, false);
  const result = classifyReviewDebt('Move the existing task to review after the smoke test passes');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'not generated-artifact shaped');
  assert.equal(reviewDebtPromptBlock('Move the existing task to review after the smoke test passes'), '');
});

test('classifyReviewDebt detects large generated artifact requests', () => {
  const result = classifyReviewDebt('Generate a full comprehensive report and detailed implementation plan for the entire dashboard workflow');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'large-output-review-debt');
  assert.ok(result.score >= 5);
  assert.ok(result.signals.generation >= 1);
  assert.ok(result.signals.artifacts >= 2);
  assert.ok(result.signals.volume >= 3);
});

test('classifyReviewDebt does not nag when review frame already exists', () => {
  const message = 'Build the feature in small increments with a diff summary, tests, risk notes, acceptance criteria, and verification';
  const result = classifyReviewDebt(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'operator already supplied review frame');
});

test('reviewDebtPromptBlock asks for slice summary review surface verification and risk notes', () => {
  const block = reviewDebtPromptBlock('Write a complete codebase and long spec from scratch');
  assert.match(block, /REVIEW-DEBT CHECK/);
  assert.match(block, /Slice/);
  assert.match(block, /Change summary/);
  assert.match(block, /Review surface/);
  assert.match(block, /Verification/);
  assert.match(block, /Risk notes/);
});

test('appendReviewDebtPrompt preserves original request first', () => {
  const message = 'Create a full website and complete content package';
  const augmented = appendReviewDebtPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[REVIEW-DEBT CHECK\]/);
});
