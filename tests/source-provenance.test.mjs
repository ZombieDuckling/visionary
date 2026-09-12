import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifySourceProvenance,
  sourceProvenancePromptBlock,
  appendSourceProvenancePrompt
} = require('../src/source-provenance.js');

test('classifySourceProvenance ignores concrete non-research tasks', () => {
  const result = classifySourceProvenance('Restart the local server and check the health endpoint');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no research/data/source signal');
  assert.equal(sourceProvenancePromptBlock('Restart the local server and check the health endpoint'), '');
});

test('classifySourceProvenance detects traceable synthesis work', () => {
  const result = classifySourceProvenance('Research and analyze these transcripts and dataset notes into a reusable summary taxonomy index');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'provenance-workbench');
  assert.ok(result.score >= 8);
  assert.ok(result.signals.source_work >= 3);
  assert.ok(result.signals.output >= 2);
});

test('classifySourceProvenance detects source gap checks for source-heavy asks', () => {
  const result = classifySourceProvenance('Research the archive notes and citations for recurring claims');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'source-gap-check');
  assert.ok(result.signals.source_work >= 2);
});

test('classifySourceProvenance does not nag when provenance frame already exists', () => {
  const message = 'Build a research table with source ids, citations, confidence, assumptions, gaps, verification, and raw source links';
  const result = classifySourceProvenance(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'operator already supplied source-provenance frame');
});

test('sourceProvenancePromptBlock asks for inventory transformations confidence structure and verification', () => {
  const block = sourceProvenancePromptBlock('Organize interview notes and dataset findings into a taxonomy');
  assert.match(block, /SOURCE-PROVENANCE CHECK/);
  assert.match(block, /Source inventory/);
  assert.match(block, /Transformations/);
  assert.match(block, /Confidence and gaps/);
  assert.match(block, /Reusable structure/);
  assert.match(block, /Verification/);
});

test('appendSourceProvenancePrompt preserves original request first', () => {
  const message = 'Synthesize repository lessons into a knowledgebase index';
  const augmented = appendSourceProvenancePrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[SOURCE-PROVENANCE CHECK\]/);
});
