import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyScopedMemoryRouting,
  scopedMemoryRoutingPromptBlock,
  appendScopedMemoryRoutingPrompt
} = require('../src/scoped-memory-routing.js');

test('classifyScopedMemoryRouting ignores ordinary tasks without durable memory work', () => {
  const result = classifyScopedMemoryRouting('Summarize this meeting and draft a reply');
  assert.equal(result.applies, false);
  assert.equal(scopedMemoryRoutingPromptBlock('Summarize this meeting and draft a reply'), '');
});

test('classifyScopedMemoryRouting detects cross-scope preference capture', () => {
  const result = classifyScopedMemoryRouting('Remember this PDF styling preference, but only for this project workspace; update the project router instead of global memory');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'cross-scope-memory-routing');
  assert.ok(result.score >= 15);
  assert.ok(result.signals.memory >= 2);
  assert.ok(result.signals.scope >= 3);
});

test('classifyScopedMemoryRouting detects procedure capture work', () => {
  const result = classifyScopedMemoryRouting('Save this repeated CAD review procedure as a skill with examples and an acceptance check');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'memory-capture-routing');
  assert.ok(result.signals.capture >= 1);
});

test('scopedMemoryRoutingPromptBlock names classification, scope, bleed prevention, handle, and check', () => {
  const block = scopedMemoryRoutingPromptBlock('Add this preference to memory and route it to the right project folder, not every chat');
  assert.match(block, /SCOPED-MEMORY ROUTING CHECK/);
  assert.match(block, /Classify the item/);
  assert.match(block, /Choose the storage scope/);
  assert.match(block, /Prevent bleed/);
  assert.match(block, /retrieval handle/);
  assert.match(block, /lightweight check/);
});

test('appendScopedMemoryRoutingPrompt preserves prompt and appends scoped-memory block', () => {
  const message = 'Store this agent onboarding procedure in the repo docs and index it for future workbench runs';
  const augmented = appendScopedMemoryRoutingPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[SCOPED-MEMORY ROUTING CHECK\]/);
});
