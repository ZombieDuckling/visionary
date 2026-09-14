import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifySourceMapBeforeSearch,
  sourceMapBeforeSearchPromptBlock,
  appendSourceMapBeforeSearchPrompt
} = require('../src/source-map-before-search.js');

test('classifySourceMapBeforeSearch ignores ordinary non-workspace tasks', () => {
  const result = classifySourceMapBeforeSearch('Restart the local server and report health');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no repo/folder/workspace signal');
  assert.equal(sourceMapBeforeSearchPromptBlock('Restart the local server and report health'), '');
});

test('classifySourceMapBeforeSearch detects repo orientation work', () => {
  const result = classifySourceMapBeforeSearch('Onboard a new agent to this repository, inspect the docs, scripts, and source files, then implement the fix');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'workspace-orientation');
  assert.ok(result.score >= 12);
  assert.ok(result.signals.workspace >= 3);
  assert.ok(result.signals.action >= 3);
});

test('classifySourceMapBeforeSearch detects path-bounded execution work', () => {
  const result = classifySourceMapBeforeSearch('Find and fix the component wiring in the project docs and scripts');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'path-bounded-execution');
});

test('classifySourceMapBeforeSearch does not nag when source-map frame already exists', () => {
  const message = 'Use the README and workspace map as the source map, then inspect the repo with a file tree before search';
  const result = classifySourceMapBeforeSearch(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'operator already supplied source-map frame');
});

test('sourceMapBeforeSearchPromptBlock names map, tree, bounded search, references, and verification', () => {
  const block = sourceMapBeforeSearchPromptBlock('Audit the repository and update the docs and scripts');
  assert.match(block, /SOURCE-MAP BEFORE SEARCH CHECK/);
  assert.match(block, /Existing map first/);
  assert.match(block, /Concise tree/);
  assert.match(block, /Path-bounded search/);
  assert.match(block, /Stable references/);
  assert.match(block, /Verification/);
});

test('appendSourceMapBeforeSearchPrompt preserves original request first', () => {
  const message = 'Review this codebase and fix the failing module';
  const augmented = appendSourceMapBeforeSearchPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[SOURCE-MAP BEFORE SEARCH CHECK\]/);
});
