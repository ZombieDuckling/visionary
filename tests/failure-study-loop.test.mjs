import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyFailureStudyLoop,
  failureStudyLoopPromptBlock,
  appendFailureStudyLoopPrompt
} = require('../src/failure-study-loop.js');

test('classifyFailureStudyLoop ignores empty and non-failure prompts', () => {
  assert.equal(classifyFailureStudyLoop('').applies, false);
  const result = classifyFailureStudyLoop('Draft a product launch announcement for the dashboard');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no failure/debug signal');
  assert.equal(failureStudyLoopPromptBlock('Draft a product launch announcement for the dashboard'), '');
});

test('classifyFailureStudyLoop detects debug prompts that need root cause', () => {
  const result = classifyFailureStudyLoop('Debug the broken dispatch flow, fix the failing test, and explain why it failed');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'debug-with-root-cause');
  assert.ok(result.score >= 6);
  assert.ok(result.signals.failures >= 3);
});

test('classifyFailureStudyLoop detects explicit learning from failures', () => {
  const result = classifyFailureStudyLoop('Review this incident and turn the failure into lessons so it does not repeat');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'post-failure-learning-loop');
  assert.ok(result.signals.study >= 2);
});

test('classifyFailureStudyLoop does not nag when failure-analysis frame already exists', () => {
  const message = 'Fix the bug using the repro steps, failing test, root cause, and rollback plan already documented';
  const result = classifyFailureStudyLoop(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'operator already supplied failure-analysis frame');
});

test('failureStudyLoopPromptBlock asks for evidence concept fix artifact and transfer check', () => {
  const block = failureStudyLoopPromptBlock('Fix the broken scheduler error and prevent it from happening again');
  assert.match(block, /FAILURE-STUDY LOOP/);
  assert.match(block, /Evidence first/);
  assert.match(block, /Missing concept/);
  assert.match(block, /Fix path/);
  assert.match(block, /Study artifact/);
  assert.match(block, /Transfer check/);
});

test('appendFailureStudyLoopPrompt preserves original request first', () => {
  const message = 'Fix this recurring crash and explain the lesson';
  const augmented = appendFailureStudyLoopPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[FAILURE-STUDY LOOP\]/);
});
