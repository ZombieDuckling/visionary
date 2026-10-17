import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyWorkflowCapture,
  workflowCapturePromptBlock,
  appendWorkflowCapturePrompt
} = require('../src/workflow-capture.js');

test('classifyWorkflowCapture ignores empty and ordinary prompts', () => {
  assert.equal(classifyWorkflowCapture('').applies, false);
  const result = classifyWorkflowCapture('Rename the project folder and fix the broken link');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'not a repeated/automated/delegated job');
  assert.equal(workflowCapturePromptBlock('Rename the project folder and fix the broken link'), '');
});

test('classifyWorkflowCapture detects a repeated job about to be automated', () => {
  const result = classifyWorkflowCapture('Automate our weekly client reporting so it runs on a schedule every week');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'capture-before-automation');
  assert.ok(result.signals.automation >= 2);
});

test('classifyWorkflowCapture detects delegation to an agent', () => {
  const result = classifyWorkflowCapture('Delegate inbox triage to an agent so I don\'t have to do it manually anymore');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'capture-before-delegation');
  assert.ok(result.signals.delegation >= 2);
});

test('classifyWorkflowCapture does not nag when a capture frame already exists', () => {
  const message = 'Automate the report: here is the input, the output, the human check, and the two-minute write-up';
  const result = classifyWorkflowCapture(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'operator already supplied capture frame');
});

test('workflowCapturePromptBlock names the two-minute test, four headings, and fresh-chat gate', () => {
  const block = workflowCapturePromptBlock('Automate the monthly invoicing routine');
  assert.match(block, /WORKFLOW-CAPTURE CHECK/);
  assert.match(block, /Two-minute test/);
  assert.match(block, /Input:/);
  assert.match(block, /Do:/);
  assert.match(block, /Output:/);
  assert.match(block, /Human check:/);
  assert.match(block, /Fresh-chat reproduction/);
  assert.match(block, /Automate only after/);
});

test('appendWorkflowCapturePrompt preserves the original request first', () => {
  const message = 'Set up a recurring weekly ops digest to run automatically';
  const augmented = appendWorkflowCapturePrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[WORKFLOW-CAPTURE CHECK\]/);
});
