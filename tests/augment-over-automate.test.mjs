import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyAugmentOverAutomate,
  augmentOverAutomatePromptBlock,
  appendAugmentOverAutomatePrompt
} = require('../src/augment-over-automate.js');

test('classifyAugmentOverAutomate ignores empty and non-automation prompts', () => {
  assert.equal(classifyAugmentOverAutomate('').applies, false);
  const result = classifyAugmentOverAutomate('Summarize the client meeting notes for the weekly digest');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'not an automation request');
  assert.equal(augmentOverAutomatePromptBlock('Summarize the client meeting notes for the weekly digest'), '');
});

test('classifyAugmentOverAutomate detects a riderless automation claim', () => {
  const result = classifyAugmentOverAutomate('Make this report fully automated and hands-off — no human in the loop');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'riderless-automation-claim');
  assert.ok(result.signals.riderless >= 2);
});

test('classifyAugmentOverAutomate does not nag when a human frame is supplied', () => {
  const message = 'Automate the report pipeline, but keep a human approval step and an escalation path for exceptions';
  const result = classifyAugmentOverAutomate(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'augmentation frame already present');
});

test('classifyAugmentOverAutomate ignores a weak, non-riderless automation mention', () => {
  const result = classifyAugmentOverAutomate('The agent should automate this');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'weak automation signal');
});

test('augmentOverAutomatePromptBlock names who is augmented, structure, steering and verification', () => {
  const block = augmentOverAutomatePromptBlock('Build an autonomous agent that runs the intake end-to-end unattended');
  assert.match(block, /AUGMENT-OVER-AUTOMATE CHECK/);
  assert.match(block, /Who is augmented:/);
  assert.match(block, /What structure is supplied:/);
  assert.match(block, /Where the human steers:/);
  assert.match(block, /What is verified:/);
  assert.match(block, /safe to fully automate:/);
});

test('appendAugmentOverAutomatePrompt preserves the original request first', () => {
  const message = 'Delegate the whole onboarding workflow to an unattended agent';
  const augmented = appendAugmentOverAutomatePrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[AUGMENT-OVER-AUTOMATE CHECK\]/);
});
