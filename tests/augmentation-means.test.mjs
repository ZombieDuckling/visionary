import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyAugmentationMeans,
  augmentationMeansPromptBlock,
  appendAugmentationMeansPrompt
} = require('../src/augmentation-means.js');

test('classifyAugmentationMeans ignores empty and non-capability prompts', () => {
  assert.equal(classifyAugmentationMeans('').applies, false);
  const result = classifyAugmentationMeans('Refactor the settings route and run the unit tests');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'not a tooling-first capability request');
  assert.equal(augmentationMeansPromptBlock('Refactor the settings route and run the unit tests'), '');
});

test('classifyAugmentationMeans flags a tooling-first build', () => {
  const result = classifyAugmentationMeans('Build a tool that drafts client updates');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'tooling-first-build');
  assert.ok(result.signals.tooling >= 1);
  assert.ok(result.signals.build >= 1);
});

test('classifyAugmentationMeans flags adding a feature to the dashboard', () => {
  const result = classifyAugmentationMeans('Add a feature to the dashboard');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'tooling-first-build');
});

test('classifyAugmentationMeans does not nag when the means are already named', () => {
  const message = 'Build the tool with an SOP, runbook, glossary, and training for new operators';
  const result = classifyAugmentationMeans(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'augmentation means already named');
});

test('classifyAugmentationMeans ignores a bare tool mention with no build signal', () => {
  const result = classifyAugmentationMeans('The dashboard is slow');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'weak tooling-first signal');
});

test('classifyAugmentationMeans flags an augmentation claim with no means named', () => {
  const result = classifyAugmentationMeans('We should augment the team');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'augmentation-claim-without-means');
});

test('classifyAugmentationMeans ignores an augmentation claim that already names a mean', () => {
  const result = classifyAugmentationMeans('Augment the workflow with training');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'partial means present');
});

test('classifyAugmentationMeans ignores AI-as-worker framing with no tool target', () => {
  const result = classifyAugmentationMeans('Now that AI can do the work, what should we build?');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'not a tooling-first capability request');
});

test('augmentationMeansPromptBlock names artifacts, language, methodology and training', () => {
  const block = augmentationMeansPromptBlock('Add a feature to the dashboard for the client reports');
  assert.match(block, /AUGMENTATION-MEANS CHECK/);
  assert.match(block, /Artifacts:/);
  assert.match(block, /Language:/);
  assert.match(block, /Methodology:/);
  assert.match(block, /Training:/);
  assert.match(block, /Higher-order role:/);
  assert.match(block, /Primitives and composition:/);
  assert.match(block, /Organization toward goal:/);
  assert.match(block, /Verdict:/);
});

test('appendAugmentationMeansPrompt preserves the original request first', () => {
  const message = 'Build a connector capability for the platform';
  const augmented = appendAugmentationMeansPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[AUGMENTATION-MEANS CHECK\]/);
});
