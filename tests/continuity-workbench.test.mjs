import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyContinuityWorkbench,
  continuityWorkbenchPromptBlock,
  appendContinuityWorkbenchPrompt
} = require('../src/continuity-workbench.js');

test('classifyContinuityWorkbench ignores fresh one-shot work', () => {
  const result = classifyContinuityWorkbench('Ask Designer to draft a landing page concept');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no continuity signal');
  assert.equal(continuityWorkbenchPromptBlock('Ask Designer to draft a landing page concept'), '');
});

test('classifyContinuityWorkbench detects state reconciliation handoffs', () => {
  const result = classifyContinuityWorkbench('Resume where we left off from the latest handoff, check the current artifact workdir and status');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'state-reconciliation');
  assert.ok(result.score >= 10);
  assert.ok(result.signals.continuity >= 2);
  assert.ok(result.signals.state >= 2);
});

test('classifyContinuityWorkbench detects finish-and-verify continuations', () => {
  const result = classifyContinuityWorkbench('Continue the previous implementation, finish the smoke test, verify it, and report blockers');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'finish-and-verify');
  assert.ok(result.signals.delivery >= 3);
});

test('continuityWorkbenchPromptBlock names state, sources, delta, blockers, and verification', () => {
  const block = continuityWorkbenchPromptBlock('Pick up the current backlog item from the last run and verify the remaining diff');
  assert.match(block, /CONTINUITY-WORKBENCH CHECK/);
  assert.match(block, /Last known state/);
  assert.match(block, /Source pointers/);
  assert.match(block, /Delta to execute/);
  assert.match(block, /Blockers and assumptions/);
  assert.match(block, /Verification trail/);
});

test('appendContinuityWorkbenchPrompt preserves original request first', () => {
  const message = 'Follow up on the blocked deployment from the latest log and report status';
  const augmented = appendContinuityWorkbenchPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[CONTINUITY-WORKBENCH CHECK\]/);
});
