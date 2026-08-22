import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifySystemDecomposition,
  systemDecompositionPromptBlock,
  appendSystemDecompositionPrompt
} = require('../src/system-decomposition.js');

test('classifySystemDecomposition ignores ordinary non-system work', () => {
  const result = classifySystemDecomposition('Draft a short note about lunch options');
  assert.equal(result.applies, false);
  assert.equal(systemDecompositionPromptBlock('Draft a short note about lunch options'), '');
});

test('classifySystemDecomposition detects agent/protocol production work', () => {
  const result = classifySystemDecomposition('Build a reliable MCP tool integration with schema validation, retries, logs, and secret isolation');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'production-system');
  assert.ok(result.score >= 8);
  assert.ok(result.signals.system >= 2);
  assert.ok(result.signals.production >= 3);
});

test('systemDecompositionPromptBlock names the operational layers', () => {
  const block = systemDecompositionPromptBlock('Ship an agent orchestration pipeline with API tools and telemetry');
  assert.match(block, /SYSTEM-DECOMPOSITION CHECK/);
  assert.match(block, /Model call/);
  assert.match(block, /Orchestration/);
  assert.match(block, /Protocol\/tool boundary/);
  assert.match(block, /Parsing\/validation/);
  assert.match(block, /Eval\/telemetry/);
  assert.match(block, /Human accountability/);
});

test('appendSystemDecompositionPrompt preserves the original request first', () => {
  const message = 'Create an agent runtime connector with retry and cost logs';
  const augmented = appendSystemDecompositionPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[SYSTEM-DECOMPOSITION CHECK\]/);
});
