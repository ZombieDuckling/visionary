import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { classifyValueLayer, valueLayerPromptBlock, appendValueLayerPrompt } = require('../src/value-layer.js');

test('classifyValueLayer ignores ordinary non-product errands', () => {
  const result = classifyValueLayer('Check whether port 3333 is open');
  assert.equal(result.applies, false);
  assert.equal(valueLayerPromptBlock('Check whether port 3333 is open'), '');
});

test('classifyValueLayer detects product and workflow-shaped tasks', () => {
  const result = classifyValueLayer('Design a workflow dashboard feature for onboarding new agent roles');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'workflow-or-interactive-system');
  assert.ok(result.score >= 5);
  assert.ok(result.signals.product >= 2);
});

test('valueLayerPromptBlock asks for defensible context and smallest prototype', () => {
  const block = valueLayerPromptBlock('Build a SaaS automation that generates reports for clients');
  assert.match(block, /VALUE-LAYER CHECK/);
  assert.match(block, /vendor-commoditizable/);
  assert.match(block, /Defensible context/);
  assert.match(block, /Smallest prototype/);
  assert.match(block, /Review\/telemetry/);
});

test('appendValueLayerPrompt preserves the original request first', () => {
  const message = 'Improve the onboarding UX for custom agent personas';
  const augmented = appendValueLayerPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[VALUE-LAYER CHECK\]/);
});
