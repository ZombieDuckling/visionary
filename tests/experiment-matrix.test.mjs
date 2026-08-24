import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyExperimentMatrix,
  experimentMatrixPromptBlock,
  appendExperimentMatrixPrompt
} = require('../src/experiment-matrix.js');

test('classifyExperimentMatrix ignores ordinary direct build work', () => {
  const result = classifyExperimentMatrix('Fix the settings button and commit the UI change');
  assert.equal(result.applies, false);
  assert.equal(experimentMatrixPromptBlock('Fix the settings button and commit the UI change'), '');
});

test('classifyExperimentMatrix detects model/persona evaluation work', () => {
  const result = classifyExperimentMatrix('Compare models across three personas using a truth deck, JSON export, refusals, parse errors, cost, and latency');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'auditable-experiment-pipeline');
  assert.ok(result.score >= 10);
  assert.ok(result.signals.eval >= 1);
  assert.ok(result.signals.matrix >= 3);
  assert.ok(result.signals.output >= 3);
});

test('experimentMatrixPromptBlock names reproducibility and failure-accounting requirements', () => {
  const block = experimentMatrixPromptBlock('Evaluate prompt variants on several benchmark cases and export CSV results');
  assert.match(block, /EXPERIMENT-MATRIX CHECK/);
  assert.match(block, /Variables/);
  assert.match(block, /Output contract/);
  assert.match(block, /Deterministic parsing/);
  assert.match(block, /Failure data/);
  assert.match(block, /Evidence trail/);
});

test('appendExperimentMatrixPrompt preserves the original request first', () => {
  const message = 'Run an eval comparing coder and reviewer role prompts over five cases';
  const augmented = appendExperimentMatrixPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[EXPERIMENT-MATRIX CHECK\]/);
});
