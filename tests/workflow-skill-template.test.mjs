import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyWorkflowSkillTemplate,
  workflowSkillTemplatePromptBlock,
  appendWorkflowSkillTemplatePrompt
} = require('../src/workflow-skill-template.js');

test('classifyWorkflowSkillTemplate ignores ordinary one-shot work', () => {
  const result = classifyWorkflowSkillTemplate('Ask Scout for a quick local market signal summary');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'not reusable-workflow shaped');
  assert.equal(workflowSkillTemplatePromptBlock('Ask Scout for a quick local market signal summary'), '');
});

test('classifyWorkflowSkillTemplate detects portable markdown skills', () => {
  const result = classifyWorkflowSkillTemplate('Create a markdown skill file with reusable instructions, examples, and must-avoid cases');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'portable-markdown-skill');
  assert.ok(result.signals.workflow >= 2);
  assert.ok(result.signals.build >= 1);
  assert.ok(result.signals.portability >= 2);
});

test('classifyWorkflowSkillTemplate detects reusable playbooks and templates', () => {
  const result = classifyWorkflowSkillTemplate('Build a repeatable SOP playbook template with pressure-test cases for each run');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'reusable-workflow-template');
});

test('workflowSkillTemplatePromptBlock names the durable workflow asset requirements', () => {
  const block = workflowSkillTemplatePromptBlock('Codify this recurring workflow into a reusable markdown template');
  assert.match(block, /WORKFLOW-SKILL-TEMPLATE CHECK/);
  assert.match(block, /Canonical markdown/);
  assert.match(block, /Scope boundary/);
  assert.match(block, /Procedure/);
  assert.match(block, /Pressure test/);
  assert.match(block, /Revision loop/);
});

test('appendWorkflowSkillTemplatePrompt preserves original request first', () => {
  const message = 'Write a reusable workflow file for reviewing agent outputs';
  const augmented = appendWorkflowSkillTemplatePrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[WORKFLOW-SKILL-TEMPLATE CHECK\]/);
});
