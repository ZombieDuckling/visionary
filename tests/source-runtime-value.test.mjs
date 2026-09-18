import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifySourceRuntimeValue,
  sourceRuntimeValuePromptBlock,
  appendSourceRuntimeValuePrompt
} = require('../src/source-runtime-value.js');

test('classifySourceRuntimeValue ignores ordinary non-source tasks', () => {
  const result = classifySourceRuntimeValue('Draft a quick note about tomorrow priorities');
  assert.equal(result.applies, false);
  assert.equal(sourceRuntimeValuePromptBlock('Draft a quick note about tomorrow priorities'), '');
});

test('classifySourceRuntimeValue detects source-to-product gaps', () => {
  const result = classifySourceRuntimeValue('Clone this repo and turn the app into a customer workflow dashboard MVP');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'source-to-product-gap');
  assert.ok(result.signals.source >= 1);
  assert.ok(result.signals.product >= 2);
});

test('classifySourceRuntimeValue detects runtime value audits', () => {
  const result = classifySourceRuntimeValue('Import the leaked source code and ship it with auth, database, secrets, deploy, logs, and tests');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'runtime-value-audit');
  assert.ok(result.signals.runtime >= 3);
});

test('sourceRuntimeValuePromptBlock names source, runtime, workflow, delivery, and value boundaries', () => {
  const block = sourceRuntimeValuePromptBlock('Fork the GitHub template into an agent platform with deployment');
  assert.match(block, /SOURCE-RUNTIME VALUE CHECK/);
  assert.match(block, /Source inventory/);
  assert.match(block, /Runtime wiring/);
  assert.match(block, /Workflow fit/);
  assert.match(block, /Delivery proof/);
  assert.match(block, /Value boundary/);
});

test('appendSourceRuntimeValuePrompt preserves the original request first', () => {
  const message = 'Clone the repo and migrate the product into our dashboard workflow';
  const augmented = appendSourceRuntimeValuePrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[SOURCE-RUNTIME VALUE CHECK\]/);
});
