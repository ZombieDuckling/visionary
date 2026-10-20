import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyCrossDomainAdjacency,
  crossDomainAdjacencyPromptBlock,
  appendCrossDomainAdjacencyPrompt
} = require('../src/cross-domain-adjacency.js');

test('classifyCrossDomainAdjacency ignores empty and non-learning prompts', () => {
  assert.equal(classifyCrossDomainAdjacency('').applies, false);
  const result = classifyCrossDomainAdjacency('Refactor the settings route and run the unit tests');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'not a learning/build-selection request');
  assert.equal(crossDomainAdjacencyPromptBlock('Refactor the settings route and run the unit tests'), '');
});

test('classifyCrossDomainAdjacency detects a next-skill-selection request', () => {
  const result = classifyCrossDomainAdjacency('What should I learn next on the roadmap? Keep skills sharp and pick the next target');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'next-skill-selection');
  assert.ok(result.signals.learning >= 2);
  assert.ok(result.signals.selection >= 1);
});

test('classifyCrossDomainAdjacency does not nag when adjacency is already named', () => {
  const message = 'Pick the next skill at the overlap of my existing skills and background in embedded work';
  const result = classifyCrossDomainAdjacency(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'adjacency frame already present');
});

test('classifyCrossDomainAdjacency ignores a weak, non-selection learning mention', () => {
  const result = classifyCrossDomainAdjacency('I want to learn Rust');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'weak learning signal');
});

test('crossDomainAdjacencyPromptBlock names domains, adjacency, discount scoring, ledger and verification', () => {
  const block = crossDomainAdjacencyPromptBlock('What should I learn next for the roadmap?');
  assert.match(block, /CROSS-DOMAIN ADJACENCY CHECK/);
  assert.match(block, /Domains already carried:/);
  assert.match(block, /The adjacency:/);
  assert.match(block, /Score by transfer discount:/);
  assert.match(block, /Choose the overlap deliberately:/);
  assert.match(block, /Capture eurekas when they fire:/);
  assert.match(block, /Verify:/);
});

test('appendCrossDomainAdjacencyPrompt preserves the original request first', () => {
  const message = 'What should I build next — rank the next skill options for me';
  const augmented = appendCrossDomainAdjacencyPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[CROSS-DOMAIN ADJACENCY CHECK\]/);
});
