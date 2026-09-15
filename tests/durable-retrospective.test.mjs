import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyDurableRetrospective,
  durableRetrospectivePromptBlock,
  appendDurableRetrospectivePrompt
} = require('../src/durable-retrospective.js');

test('classifyDurableRetrospective ignores ordinary build requests', () => {
  const result = classifyDurableRetrospective('Build the dashboard export feature and run the tests');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no retrospective signal');
  assert.equal(durableRetrospectivePromptBlock('Build the dashboard export feature and run the tests'), '');
});

test('classifyDurableRetrospective detects review of old AI strategy', () => {
  const result = classifyDurableRetrospective('Revisit our 2023 AI agent roadmap and say what held up, what changed, and what should be updated now');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'principle-ledger');
  assert.ok(result.score >= 14);
  assert.ok(result.signals.retrospective >= 2);
  assert.ok(result.signals.time >= 2);
  assert.ok(result.signals.ai_product >= 2);
});

test('classifyDurableRetrospective detects product strategy refresh work', () => {
  const result = classifyDurableRetrospective('Review old predictions about AI workflow tools and update the product strategy');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'strategy-refresh');
});

test('classifyDurableRetrospective avoids weak nostalgia without product or time context', () => {
  const result = classifyDurableRetrospective('Write a retro summary of the launch party');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'retrospective signal lacks product/time context');
});

test('durableRetrospectivePromptBlock names source, held-up principles, changes, decisions, and reusable structure', () => {
  const block = durableRetrospectivePromptBlock('Revisit the old AI product plan from 2024 and update it');
  assert.match(block, /DURABLE-RETROSPECTIVE CHECK/);
  assert.match(block, /Original claim or plan/);
  assert.match(block, /Held up/);
  assert.match(block, /Changed/);
  assert.match(block, /Decision/);
  assert.match(block, /Reusable structure/);
});

test('appendDurableRetrospectivePrompt preserves original request first', () => {
  const message = 'Review our old AI agent predictions and update the roadmap';
  const augmented = appendDurableRetrospectivePrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[DURABLE-RETROSPECTIVE CHECK\]/);
});
