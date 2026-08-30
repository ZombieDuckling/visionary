import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyChallengeDesign,
  challengeDesignPromptBlock,
  appendChallengeDesignPrompt
} = require('../src/challenge-design.js');

test('classifyChallengeDesign ignores empty and non-output operational prompts', () => {
  assert.equal(classifyChallengeDesign('').applies, false);
  const result = classifyChallengeDesign('Move task 12 to review after the run completes');
  assert.equal(result.applies, false);
  assert.equal(challengeDesignPromptBlock('Move task 12 to review after the run completes'), '');
});

test('classifyChallengeDesign detects short broad output work', () => {
  const result = classifyChallengeDesign('Draft a quick plan for onboarding agents');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'baseline-ratchet');
  assert.ok(result.score >= 4);
  assert.ok(result.signals.output >= 1);
});

test('classifyChallengeDesign does not nag when a quality bar already exists', () => {
  const message = 'Write the project brief with sources, acceptance criteria, examples, and must avoid failure modes';
  const result = classifyChallengeDesign(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'operator already supplied quality bar');
});

test('challengeDesignPromptBlock names audience, stale baseline, rubric, examples, and delivery', () => {
  const block = challengeDesignPromptBlock('Make me a generic research summary about AI dashboards');
  assert.match(block, /CHALLENGE-DESIGN CHECK/);
  assert.match(block, /intended audience/);
  assert.match(block, /stale\/easy baseline/);
  assert.match(block, /quality rubric/);
  assert.match(block, /specific examples/);
  assert.match(block, /deliver the requested artifact/);
});

test('appendChallengeDesignPrompt preserves original request first', () => {
  const message = 'Generate a few ideas for improving the ops dashboard';
  const augmented = appendChallengeDesignPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[CHALLENGE-DESIGN CHECK\]/);
});
