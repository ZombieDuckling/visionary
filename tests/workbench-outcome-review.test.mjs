import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyWorkbenchOutcomeReview,
  workbenchOutcomeReviewPromptBlock,
  appendWorkbenchOutcomeReviewPrompt
} = require('../src/workbench-outcome-review.js');

test('classifyWorkbenchOutcomeReview ignores ordinary build requests', () => {
  const result = classifyWorkbenchOutcomeReview('Build a dashboard widget for task status and run the smoke tests');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'not a post-delivery or follow-up review');
  assert.equal(workbenchOutcomeReviewPromptBlock('Build a dashboard widget for task status and run the smoke tests'), '');
});

test('classifyWorkbenchOutcomeReview detects post-training workbench follow-up', () => {
  const result = classifyWorkbenchOutcomeReview('Follow up after the client workshop: review the automation workbench, capture outcome evidence, blockers, adoption, and next action');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'evidence-backed-outcome-review');
  assert.ok(result.score >= 12);
  assert.ok(result.signals.workbench >= 2);
  assert.ok(result.signals.delivery >= 2);
  assert.ok(result.signals.review >= 4);
});

test('classifyWorkbenchOutcomeReview detects deployment architecture review without explicit metrics', () => {
  const result = classifyWorkbenchOutcomeReview('Review the deployed team workflow after onboarding and identify what changed, what is blocked, and who owns the improvement');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'post-delivery-architecture-review');
  assert.ok(result.signals.delivery >= 2);
  assert.ok(result.signals.review >= 2);
});

test('classifyWorkbenchOutcomeReview does not nag when the review frame already exists', () => {
  const message = 'Run an architecture walkthrough, produce a workbench map, capture adoption evidence and failure modes, then name the owner for the next step';
  const result = classifyWorkbenchOutcomeReview(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'operator already supplied workbench-outcome review frame');
});

test('workbenchOutcomeReviewPromptBlock asks for map evidence blockers lesson and next action', () => {
  const block = workbenchOutcomeReviewPromptBlock('Check in after the client training and review whether the workflow workbench produced ROI or blockers');
  assert.match(block, /WORKBENCH-OUTCOME REVIEW/);
  assert.match(block, /Workbench map/);
  assert.match(block, /Outcome evidence/);
  assert.match(block, /Blockers and ownership/);
  assert.match(block, /Program lesson/);
  assert.match(block, /Next action/);
});

test('appendWorkbenchOutcomeReviewPrompt preserves original request first', () => {
  const message = 'Follow up after the workshop and review the workbench outcomes';
  const augmented = appendWorkbenchOutcomeReviewPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[WORKBENCH-OUTCOME REVIEW\]/);
});
