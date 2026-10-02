import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyWorkbenchPrerequisiteGate,
  workbenchPrerequisiteGatePromptBlock,
  appendWorkbenchPrerequisiteGatePrompt
} = require('../src/workbench-prerequisite-gate.js');

test('classifyWorkbenchPrerequisiteGate ignores cosmetic agent UI changes', () => {
  const result = classifyWorkbenchPrerequisiteGate('Rename the agent label and change its icon color');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'cosmetic agent UI request, not workflow prerequisites');
  assert.equal(workbenchPrerequisiteGatePromptBlock('Rename the assistant badge color'), '');
});

test('classifyWorkbenchPrerequisiteGate detects agent work with missing prerequisites', () => {
  const result = classifyWorkbenchPrerequisiteGate('Build an AI agent workflow that checks email, updates CRM tickets, and dispatches support tasks');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'work-context-prerequisite-gate');
  assert.ok(result.score >= 12);
  assert.ok(result.signals.aiAgent >= 3);
  assert.ok(result.signals.work >= 3);
});

test('classifyWorkbenchPrerequisiteGate detects explicit prerequisite contracts', () => {
  const result = classifyWorkbenchPrerequisiteGate('Create an assistant with a SOP, role context, connector permissions, secret isolation, cost limits, and audit review');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'explicit-prerequisite-contract');
  assert.ok(result.signals.prereq >= 6);
});

test('workbenchPrerequisiteGatePromptBlock names procedure, role context, access, permission, and cost governance', () => {
  const block = workbenchPrerequisiteGatePromptBlock('Automate a sales agent that reads inbox leads, writes CRM notes, verifies actions, and stays within a token budget');
  assert.match(block, /WORKBENCH-PREREQUISITE GATE/);
  assert.match(block, /Procedure\/skill/);
  assert.match(block, /Role\/user context/);
  assert.match(block, /Source and connector access/);
  assert.match(block, /Permission\/read-back boundary/);
  assert.match(block, /Cost\/governance limit/);
});

test('appendWorkbenchPrerequisiteGatePrompt preserves original request first', () => {
  const message = 'Dispatch an agent to manage support tickets from email and update the repo docs';
  const augmented = appendWorkbenchPrerequisiteGatePrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[WORKBENCH-PREREQUISITE GATE\]/);
});
