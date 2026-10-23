import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyCompanyBrain,
  companyBrainPromptBlock,
  appendCompanyBrainPrompt
} = require('../src/company-brain.js');

test('classifyCompanyBrain ignores empty and non-org prompts', () => {
  assert.equal(classifyCompanyBrain('').applies, false);
  const result = classifyCompanyBrain('Refactor the settings route and run the unit tests');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'not an org-knowledge/routing request');
  assert.equal(companyBrainPromptBlock('Refactor the settings route and run the unit tests'), '');
});

test('classifyCompanyBrain flags an explicit company-brain request', () => {
  const result = classifyCompanyBrain('Build a company brain so the team can find what to do next');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'explicit-company-brain');
  assert.ok(result.signals.explicit >= 1);
});

test('classifyCompanyBrain flags a knowledge-base build', () => {
  const result = classifyCompanyBrain('Stand up a knowledge base for onboarding new hires');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'explicit-company-brain');
});

test('classifyCompanyBrain flags an implied org-routing request', () => {
  const result = classifyCompanyBrain('Onboarding new hires is painful — we need docs that tell them who owns what');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'implied-company-brain');
});

test('classifyCompanyBrain does not nag when the package fields are already named', () => {
  const message = 'Build the company knowledge base with an org chart, SOPs, routing rules, and a permission boundary';
  const result = classifyCompanyBrain(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'company-brain package already named');
});

test('classifyCompanyBrain ignores a bare org mention with no routing/knowledge signal', () => {
  const result = classifyCompanyBrain('The team shipped the release yesterday');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'not an org-knowledge/routing request');
});

test('companyBrainPromptBlock names the package parts', () => {
  const block = companyBrainPromptBlock('Build a company brain for the department');
  assert.match(block, /COMPANY-BRAIN CHECK/);
  assert.match(block, /Responsibility map:/);
  assert.match(block, /SOPs \/ playbooks:/);
  assert.match(block, /Request routing \+ approval:/);
  assert.match(block, /Query surface:/);
  assert.match(block, /Correction \/ memory loop:/);
  assert.match(block, /Permission \/ provenance boundary:/);
  assert.match(block, /Review \/ telemetry:/);
  assert.match(block, /Hand over the loop:/);
  assert.match(block, /Verdict:/);
});

test('appendCompanyBrainPrompt preserves the original request first', () => {
  const message = 'We need a second brain the team can query';
  const augmented = appendCompanyBrainPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[COMPANY-BRAIN CHECK\]/);
});
