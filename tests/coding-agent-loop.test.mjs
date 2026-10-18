import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyCodingAgentLoop,
  codingAgentLoopPromptBlock,
  appendCodingAgentLoopPrompt
} = require('../src/coding-agent-loop.js');

test('classifyCodingAgentLoop ignores empty and non-coding prompts', () => {
  assert.equal(classifyCodingAgentLoop('').applies, false);
  const result = classifyCodingAgentLoop('Summarize the client meeting notes for the weekly digest');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'not a coding task');
  assert.equal(codingAgentLoopPromptBlock('Summarize the client meeting notes for the weekly digest'), '');
});

test('classifyCodingAgentLoop detects a delegated coding task', () => {
  const result = classifyCodingAgentLoop('Dispatch this refactor to Claude Code: implement the new auth module');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'delegated-coding-loop');
  assert.ok(result.signals.agent >= 1);
});

test('classifyCodingAgentLoop detects a direct coding task', () => {
  const result = classifyCodingAgentLoop('Refactor the login route and add unit tests for the token check');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'direct-coding-loop');
  assert.ok(result.signals.coding >= 2);
});

test('classifyCodingAgentLoop does not nag when a plan/verify frame already exists', () => {
  const message = 'Refactor the auth module — here are the acceptance criteria and the test plan, verify before returning';
  const result = classifyCodingAgentLoop(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'operator already supplied plan/verify frame');
});

test('codingAgentLoopPromptBlock names orient, plan, scope, edit, verify and report', () => {
  const block = codingAgentLoopPromptBlock('Implement the scheduler endpoint and add a regression test');
  assert.match(block, /CODING-AGENT LOOP CHECK/);
  assert.match(block, /Orient:/);
  assert.match(block, /Plan:/);
  assert.match(block, /Scope:/);
  assert.match(block, /Edit:/);
  assert.match(block, /Verify:/);
  assert.match(block, /Report:/);
  assert.match(block, /Persist:/);
});

test('appendCodingAgentLoopPrompt preserves the original request first', () => {
  const message = 'Refactor the CSV export module';
  const augmented = appendCodingAgentLoopPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[CODING-AGENT LOOP CHECK\]/);
});
