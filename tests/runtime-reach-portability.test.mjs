import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyRuntimeReachPortability,
  runtimeReachPortabilityPromptBlock,
  appendRuntimeReachPortabilityPrompt
} = require('../src/runtime-reach-portability.js');

test('classifyRuntimeReachPortability ignores empty and unrelated prompts', () => {
  assert.equal(classifyRuntimeReachPortability('').applies, false);
  const result = classifyRuntimeReachPortability('Refactor the settings route and run the unit tests');
  assert.equal(result.applies, false);
  assert.equal(runtimeReachPortabilityPromptBlock('Summarize this report'), '');
});

test('classifyRuntimeReachPortability flags a named runtime bound to a reach requirement', () => {
  const result = classifyRuntimeReachPortability('Use Claude to browse the government website and pull the filing details');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'runtime-reach-gap');
  assert.ok(result.signals.runtime >= 1);
  assert.ok(result.signals.reach >= 2);
});

test('classifyRuntimeReachPortability flags explicit vendor-swap pressure', () => {
  const result = classifyRuntimeReachPortability('Build this on the vendor platform but keep it portable so we can swap the model later');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'vendor-independence');
  assert.ok(result.signals.swap >= 2);
});

test('classifyRuntimeReachPortability ignores a weak descriptive runtime mention', () => {
  const result = classifyRuntimeReachPortability('This report was written by a model');
  assert.equal(result.applies, false);
});

test('runtimeReachPortabilityPromptBlock names reach, runtime fit, replay, vendor-independence and verdict', () => {
  const block = runtimeReachPortabilityPromptBlock('Connect an OpenAI agent to our API and database');
  assert.match(block, /RUNTIME-REACH PORTABILITY CHECK/);
  assert.match(block, /Named reach requirement/);
  assert.match(block, /Runtime capability fit/);
  assert.match(block, /Cross-runtime replay/);
  assert.match(block, /Vendor-independence/);
  assert.match(block, /Fallback proof/);
  assert.match(block, /Verdict:/);
});

test('runtimeReachPortabilityPromptBlock emits real newlines, not literal backslash-n', () => {
  const block = runtimeReachPortabilityPromptBlock('Connect an OpenAI agent to our API and database');
  assert.equal((block.match(/\\n/g) || []).length, 0);
  assert.ok((block.match(/\n/g) || []).length >= 8);
});

test('appendRuntimeReachPortabilityPrompt preserves the original request first', () => {
  const message = 'Run this brief in Claude — it needs to browse the web and read local files';
  const augmented = appendRuntimeReachPortabilityPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[RUNTIME-REACH PORTABILITY CHECK\]/);
});

test('appendRuntimeReachPortabilityPrompt is a no-op on unrelated prompts', () => {
  assert.equal(appendRuntimeReachPortabilityPrompt('Deploy the new build'), 'Deploy the new build');
});
