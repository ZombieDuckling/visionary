import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyAutomationTiming,
  automationTimingPromptBlock,
  appendAutomationTimingPrompt
} = require('../src/automation-timing.js');

test('classifyAutomationTiming ignores empty and ordinary operational prompts', () => {
  assert.equal(classifyAutomationTiming('').applies, false);
  const result = classifyAutomationTiming('Restart the dashboard server and check the logs');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no automation/agent/schedule intent');
  assert.equal(automationTimingPromptBlock('Restart the dashboard server and check the logs'), '');
});

test('classifyAutomationTiming ignores descriptive (non-proposal) automation mentions', () => {
  const result = classifyAutomationTiming('The automation process runs each morning and formats the report');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'descriptive mention, not a run/build request');
});

test('classifyAutomationTiming fires on adding an agent to handle a repeated task', () => {
  const result = classifyAutomationTiming('Set up an agent to handle our client reporting every time a new lead comes in');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'target-level-check');
  assert.ok(result.signals.automation >= 1);
  assert.ok(result.signals.step >= 2);
});

test('classifyAutomationTiming fires on scheduling a recurring step', () => {
  const result = classifyAutomationTiming('Add a cron that emails the daily ops summary every morning');
  assert.equal(result.applies, true);
  assert.ok(result.signals.automation >= 1);
});

test('classifyAutomationTiming fires on an escalation check when multiple surfaces are named', () => {
  const result = classifyAutomationTiming('We need to add an agent and a cron to automate the daily reporting workflow');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'escalation-check');
  assert.equal(result.signals.ladder_frame, 0);
});

test('classifyAutomationTiming steps back when the operator already supplied the escalation frame', () => {
  const message = 'Automate the reporting step but keep it at level 2 with a human checkpoint and a demotion path';
  const result = classifyAutomationTiming(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'operator already supplied the escalation frame');
});

test('automationTimingPromptBlock asks for target level, human checkpoint, evidence, demotion and verdict', () => {
  const block = automationTimingPromptBlock('Automate the invoice drafting step so it runs for each client');
  assert.match(block, /AUTOMATION-TIMING CHECK/);
  assert.match(block, /Target level/);
  assert.match(block, /Cheapest sufficient level/);
  assert.match(block, /Retained human checkpoint/);
  assert.match(block, /Promotion evidence/);
  assert.match(block, /Demotion trigger/);
  assert.match(block, /Verdict/);
});

test('appendAutomationTimingPrompt preserves the original request first', () => {
  const message = 'Add a cron that emails the daily ops summary every morning';
  const augmented = appendAutomationTimingPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[AUTOMATION-TIMING CHECK\]/);
});
