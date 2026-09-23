import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyBaselineRatchet,
  baselineRatchetPromptBlock,
  appendBaselineRatchetPrompt
} = require('../src/baseline-ratchet.js');

test('classifyBaselineRatchet ignores empty and non-improvement prompts', () => {
  assert.equal(classifyBaselineRatchet('').applies, false);
  const result = classifyBaselineRatchet('Move task 42 to review after the run completes');
  assert.equal(result.applies, false);
  assert.equal(baselineRatchetPromptBlock('Move task 42 to review after the run completes'), '');
});

test('classifyBaselineRatchet detects workflow improvement work', () => {
  const result = classifyBaselineRatchet('Improve the agent dispatch workflow and streamline review handoff');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'baseline-ratchet');
  assert.ok(result.score >= 6);
  assert.ok(result.signals.change >= 2);
  assert.ok(result.signals.workflow >= 2);
});

test('classifyBaselineRatchet does not nag when baseline frame already exists', () => {
  const message = 'Upgrade the onboarding workflow by comparing the old way, current AI baseline, benchmark, metric, and verification proof';
  const result = classifyBaselineRatchet(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'operator already supplied baseline frame');
});

test('baselineRatchetPromptBlock names old baseline, current baseline, raised expectation, verification, and scope guard', () => {
  const block = baselineRatchetPromptBlock('Modernize the ops dashboard workflow');
  assert.match(block, /BASELINE-RATCHET CHECK/);
  assert.match(block, /Old\/manual baseline/);
  assert.match(block, /Current AI baseline/);
  assert.match(block, /Raised expectation/);
  assert.match(block, /Verification/);
  assert.match(block, /Scope guard/);
});

test('appendBaselineRatchetPrompt preserves original request first', () => {
  const message = 'Optimize the product review pipeline';
  const augmented = appendBaselineRatchetPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[BASELINE-RATCHET CHECK\]/);
});
