import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyPositionAddressedMemory,
  positionAddressedMemoryPromptBlock,
  appendPositionAddressedMemoryPrompt
} = require('../src/position-addressed-memory.js');

test('classifyPositionAddressedMemory ignores empty and ordinary operational prompts', () => {
  assert.equal(classifyPositionAddressedMemory('').applies, false);
  const result = classifyPositionAddressedMemory('Restart the dashboard server and check the logs');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no memory/retrieval signal');
  assert.equal(positionAddressedMemoryPromptBlock('Restart the dashboard server and check the logs'), '');
});

test('classifyPositionAddressedMemory ignores descriptive (non-design) memory mentions', () => {
  const result = classifyPositionAddressedMemory('The agent memory persists between runs');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'memory named without a storage/layout decision');
});

test('classifyPositionAddressedMemory fires on adding a vector database to remember history', () => {
  const result = classifyPositionAddressedMemory('Should we add a vector database so the agent can remember client history across sessions?');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'memory-architecture-review');
  assert.ok(result.signals.memory >= 1);
  assert.ok(result.signals.architecture >= 1);
});

test('classifyPositionAddressedMemory fires on building a knowledge base / second brain', () => {
  const result = classifyPositionAddressedMemory('Set up a second brain with a knowledge base so agents can recall what worked');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'memory-architecture-review');
});

test('classifyPositionAddressedMemory fires an address-mode check on lighter signals', () => {
  const result = classifyPositionAddressedMemory('Store agent memory in folders');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'address-mode-check');
});

test('classifyPositionAddressedMemory steps back when the operator already named the address mode and its layout', () => {
  const message = 'Use position-addressed memory with a front desk and cascading context for the workspace';
  const result = classifyPositionAddressedMemory(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'operator already named the address mode and its layout');
});

test('positionAddressedMemoryPromptBlock asks for address mode, layout, fresh-session continuity, failure mode and verdict', () => {
  const block = positionAddressedMemoryPromptBlock('Should we add a vector database so the agent can remember client history across sessions?');
  assert.match(block, /POSITION-ADDRESSED MEMORY CHECK/);
  assert.match(block, /Address mode/);
  assert.match(block, /Prefer position first/);
  assert.match(block, /Lay out the workbench/);
  assert.match(block, /Fresh-session continuity/);
  assert.match(block, /Failure mode/);
  assert.match(block, /Verdict/);
});

test('appendPositionAddressedMemoryPrompt preserves the original request first', () => {
  const message = 'Set up a second brain with a knowledge base so agents can recall what worked';
  const augmented = appendPositionAddressedMemoryPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[POSITION-ADDRESSED MEMORY CHECK\]/);
});
