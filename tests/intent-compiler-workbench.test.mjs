import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyIntentCompilerWorkbench,
  intentCompilerWorkbenchPromptBlock,
  appendIntentCompilerWorkbenchPrompt
} = require('../src/intent-compiler-workbench.js');

test('classifyIntentCompilerWorkbench ignores ordinary one-off requests', () => {
  const result = classifyIntentCompilerWorkbench('Draft a short project update for Josh');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no durable folder/workbench signal');
  assert.equal(intentCompilerWorkbenchPromptBlock('Draft a short project update for Josh'), '');
});

test('classifyIntentCompilerWorkbench detects portable intent package work', () => {
  const result = classifyIntentCompilerWorkbench('Build a portable folder workbench that compiles operator intent, markdown instructions, scripts, tools, and agent runtime assumptions into a repeatable workflow');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'portable-intent-package');
  assert.ok(result.signals.workbench >= 3);
  assert.ok(result.signals.compiler >= 4);
});

test('classifyIntentCompilerWorkbench detects local standards maps', () => {
  const result = classifyIntentCompilerWorkbench('Create a repo workspace with README, examples, review rubric, taste standards, source-of-truth files, and output criteria for this operator job');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'local-standards-map');
  assert.ok(result.signals.intent >= 4);
});

test('intentCompilerWorkbenchPromptBlock names routing, intent, boundary, deterministic helpers, and portability', () => {
  const block = intentCompilerWorkbenchPromptBlock('Organize a folder workbench with markdown context, instructions, examples, scripts, and review rules for an agent workflow');
  assert.match(block, /Root routing file/);
  assert.match(block, /Local intent map/);
  assert.match(block, /Harness boundary/);
  assert.match(block, /Deterministic helpers/);
  assert.match(block, /Portability proof/);
});

test('appendIntentCompilerWorkbenchPrompt appends only when useful', () => {
  const plain = 'Write a quick note';
  assert.equal(appendIntentCompilerWorkbenchPrompt(plain), plain);

  const message = 'Build a portable repo workbench with README instructions, context files, scripts, tools, standards, examples, and review criteria for a repeated AI workflow';
  const augmented = appendIntentCompilerWorkbenchPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[INTENT-COMPILER WORKBENCH CHECK\]/);
});

test('classifyIntentCompilerWorkbench skips an already supplied frame', () => {
  const result = classifyIntentCompilerWorkbench('Use this intent compiler check with a root routing file and no hidden chat state for the folder workflow');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'operator already supplied intent-compiler frame');
});
