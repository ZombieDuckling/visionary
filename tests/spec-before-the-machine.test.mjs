import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifySpecBeforeMachine,
  specBeforeMachinePromptBlock,
  appendSpecBeforeMachinePrompt
} = require('../src/spec-before-the-machine.js');

test('classifySpecBeforeMachine ignores empty and unrelated prompts', () => {
  assert.equal(classifySpecBeforeMachine('').applies, false);
  const result = classifySpecBeforeMachine('Summarize the meeting notes and send a digest');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no spec-deferral or prior-artifact-composition signal');
  assert.equal(specBeforeMachinePromptBlock('Summarize the meeting notes and send a digest'), '');
});

test('classifySpecBeforeMachine flags a capability deferred on tooling parity', () => {
  const result = classifySpecBeforeMachine("The model can't do that yet — we want real-time collaboration");
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'spec-before-machine');
  assert.ok(result.signals.deferral >= 1);
  assert.ok(result.signals.capability >= 1);
});

test('classifySpecBeforeMachine flags waiting on an unsupported API/feature', () => {
  const result = classifySpecBeforeMachine('Wait until the API supports streaming and then build the feature');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'spec-before-machine');
});

test('classifySpecBeforeMachine flags prior-artifact composition', () => {
  const result = classifySpecBeforeMachine('Reuse our old drafts and rearrange them into a new report');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'prior-artifact-composition');
  assert.ok(result.signals.composition >= 1);
  assert.ok(result.signals.artifact >= 1);
});

test('classifySpecBeforeMachine does not match tokens as substrings', () => {
  // 'api' must not match inside 'aping', 'tool' must not match 'toolbox' via \b.
  const result = classifySpecBeforeMachine('I wait for the aping monkey');
  assert.equal(result.applies, false);
});

test('classifySpecBeforeMachine needs a capability object with deferral language', () => {
  const result = classifySpecBeforeMachine('Wait for the build to finish');
  assert.equal(result.applies, false);
});

test('classifySpecBeforeMachine does not nag when the spec frame is already set', () => {
  const message = 'Write the spec first — a durable spec, capability spec, editable context';
  const result = classifySpecBeforeMachine(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'spec-before-the-machine frame already established');
});

test('specBeforeMachinePromptBlock names the spec-before-the-machine parts', () => {
  const block = specBeforeMachinePromptBlock("The tool can't do this yet");
  assert.match(block, /SPEC-BEFORE-THE-MACHINE CHECK/);
  assert.match(block, /Capability spec:/);
  assert.match(block, /Do not wait on tooling:/);
  assert.match(block, /Prior artifacts as editable composition material:/);
  assert.match(block, /Name the read-back\/revise step:/);
  assert.match(block, /Measure against written intent:/);
  assert.match(block, /Verdict:/);
});

test('appendSpecBeforeMachinePrompt preserves the original request first and is a no-op otherwise', () => {
  const message = 'Reuse the existing documents to draft the new spec';
  const augmented = appendSpecBeforeMachinePrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[SPEC-BEFORE-THE-MACHINE CHECK\]/);

  const unrelated = 'Rename the column header';
  assert.equal(appendSpecBeforeMachinePrompt(unrelated), unrelated);
});
