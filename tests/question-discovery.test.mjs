import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyQuestionDiscovery,
  questionDiscoveryPromptBlock,
  appendQuestionDiscoveryPrompt
} = require('../src/question-discovery.js');

test('classifyQuestionDiscovery ignores concrete operational tasks', () => {
  const result = classifyQuestionDiscovery('Move task 12 to done after the smoke test passes');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no discovery signal');
  assert.equal(questionDiscoveryPromptBlock('Move task 12 to done after the smoke test passes'), '');
});

test('classifyQuestionDiscovery detects question-first product discovery', () => {
  const result = classifyQuestionDiscovery('Help me figure out what product workflow to automate for this client');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'question-first-discovery');
  assert.ok(result.score >= 7);
  assert.ok(result.signals.underdefined >= 1);
  assert.ok(result.signals.domain >= 2);
});

test('classifyQuestionDiscovery detects pre-execution framing for scoped but vague work', () => {
  const result = classifyQuestionDiscovery('Scope and build a plan for a customer intake dashboard');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'pre-execution-framing');
  assert.ok(result.signals.discovery >= 1);
  assert.ok(result.signals.execution >= 2);
});

test('classifyQuestionDiscovery does not nag when discovery frame already exists', () => {
  const message = 'Assess the client workflow using source material, constraints, stakeholders, unknowns, success criteria, examples, and non-goals';
  const result = classifyQuestionDiscovery(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'operator already supplied discovery frame');
});

test('questionDiscoveryPromptBlock names better question, facts, unknowns, execution frame, and verification', () => {
  const block = questionDiscoveryPromptBlock('Figure out how to shape this automation problem for a customer');
  assert.match(block, /QUESTION-DISCOVERY CHECK/);
  assert.match(block, /Better question/);
  assert.match(block, /Known facts and sources/);
  assert.match(block, /Unknowns and constraints/);
  assert.match(block, /Execution frame/);
  assert.match(block, /Verification/);
});

test('appendQuestionDiscoveryPrompt preserves original request first', () => {
  const message = 'Help me figure out what agent workflow this ops team needs';
  const augmented = appendQuestionDiscoveryPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[QUESTION-DISCOVERY CHECK\]/);
});
