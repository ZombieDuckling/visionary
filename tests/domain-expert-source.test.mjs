import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyDomainExpertSource,
  domainExpertSourcePromptBlock,
  appendDomainExpertSourcePrompt
} = require('../src/domain-expert-source.js');

test('classifyDomainExpertSource ignores generic internal code tasks', () => {
  const result = classifyDomainExpertSource('Refactor the settings route and run the unit tests');
  assert.equal(result.applies, false);
  assert.equal(domainExpertSourcePromptBlock('Refactor the settings route and run the unit tests'), '');
});

test('classifyDomainExpertSource detects domain-specific AI workflow builds', () => {
  const result = classifyDomainExpertSource('Build an AI workflow for commercial real estate lease review and investor reporting');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'domain-workflow-build');
  assert.ok(result.score >= 8);
  assert.ok(result.signals.domain >= 2);
  assert.ok(result.signals.build >= 2);
});

test('classifyDomainExpertSource escalates when expert source language is explicit', () => {
  const result = classifyDomainExpertSource('Design a customer support agent with practitioner examples, anti-examples, and domain expert sign-off');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'expert-source-required');
  assert.ok(result.signals.expert >= 2);
});

test('domainExpertSourcePromptBlock asks for owner artifacts edge cases boundaries and acceptance', () => {
  const block = domainExpertSourcePromptBlock('Prototype a finance automation dashboard for portfolio reporting agents');
  assert.match(block, /DOMAIN-EXPERT SOURCE CHECK/);
  assert.match(block, /Domain owner/);
  assert.match(block, /Source artifacts/);
  assert.match(block, /Edge cases/);
  assert.match(block, /Use boundaries/);
  assert.match(block, /Acceptance/);
});

test('appendDomainExpertSourcePrompt preserves the original request first', () => {
  const message = 'Create an AI intake tool for insurance claims reviewers';
  const augmented = appendDomainExpertSourcePrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[DOMAIN-EXPERT SOURCE CHECK\]/);
});
