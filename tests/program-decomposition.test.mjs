import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyProgramDecomposition,
  programDecompositionPromptBlock,
  appendProgramDecompositionPrompt
} = require('../src/program-decomposition.js');

test('classifyProgramDecomposition ignores empty and non-AI-framed prompts', () => {
  assert.equal(classifyProgramDecomposition('').applies, false);
  const result = classifyProgramDecomposition('Refactor the settings route and run the unit tests');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'not AI-as-worker framing');
  assert.equal(programDecompositionPromptBlock('Refactor the settings route and run the unit tests'), '');
});

test('classifyProgramDecomposition detects explicit AI-as-worker build framing', () => {
  const result = classifyProgramDecomposition('Now that AI can do the work, what should we build?');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'explicit-ai-as-worker');
  assert.ok(result.signals.ai_worker >= 2);
  assert.ok(result.signals.work >= 1);
});

test('classifyProgramDecomposition detects implied AI-as-worker framing', () => {
  const result = classifyProgramDecomposition('AI can handle this for us now');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'implied-ai-as-worker');
  assert.equal(result.signals.ai_worker, 1);
});

test('classifyProgramDecomposition does not nag when the decomposition is already named', () => {
  const message = 'Let AI do the work, but the instructions live here and the human hand-back stays with Josh';
  const result = classifyProgramDecomposition(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'decomposition already named');
});

test('classifyProgramDecomposition ignores a bare AI mention with no work target', () => {
  const result = classifyProgramDecomposition('Let AI draft it');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'weak AI-as-worker signal');
});

test('programDecompositionPromptBlock names instructions, runner, state, hand-back, ownership and verification', () => {
  const block = programDecompositionPromptBlock('Have AI handle the customer onboarding workflow');
  assert.match(block, /PROGRAM-DECOMPOSITION CHECK/);
  assert.match(block, /Instructions:/);
  assert.match(block, /Runner:/);
  assert.match(block, /Surviving state:/);
  assert.match(block, /Human hand-back:/);
  assert.match(block, /Ownership split:/);
  assert.match(block, /Verify:/);
});

test('appendProgramDecompositionPrompt preserves the original request first', () => {
  const message = 'Let AI do the reporting workflow end to end';
  const augmented = appendProgramDecompositionPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[PROGRAM-DECOMPOSITION CHECK\]/);
});
