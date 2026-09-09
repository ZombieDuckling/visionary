import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyOpportunityRouting,
  opportunityRoutingPromptBlock,
  appendOpportunityRoutingPrompt
} = require('../src/opportunity-routing.js');

test('classifyOpportunityRouting ignores generic non-market tasks', () => {
  const result = classifyOpportunityRouting('Refactor the settings route and run the unit tests');
  assert.equal(result.applies, false);
  assert.equal(opportunityRoutingPromptBlock('Refactor the settings route and run the unit tests'), '');
});

test('classifyOpportunityRouting detects paid-pain workflow requests', () => {
  const result = classifyOpportunityRouting('Build a client intake workflow that routes paid support overflow to agents');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'paid-pain-intake');
  assert.ok(result.score >= 8);
  assert.ok(result.signals.demand >= 1);
  assert.ok(result.signals.pain >= 1);
  assert.ok(result.signals.build >= 1);
});

test('opportunityRoutingPromptBlock asks for buyer cost capacity assets and proof', () => {
  const block = opportunityRoutingPromptBlock('Design a marketplace service for customer backlog and sales leads');
  assert.match(block, /OPPORTUNITY-ROUTING CHECK/);
  assert.match(block, /Buyer\/user/);
  assert.match(block, /Current cost/);
  assert.match(block, /Capacity and routing/);
  assert.match(block, /Reusable asset/);
  assert.match(block, /Proof-of-work/);
});

test('appendOpportunityRoutingPrompt preserves the original request first', () => {
  const message = 'Validate a paid automation opportunity for client reporting bottlenecks';
  const augmented = appendOpportunityRoutingPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[OPPORTUNITY-ROUTING CHECK\]/);
});
