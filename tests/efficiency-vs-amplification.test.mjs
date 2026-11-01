import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyEfficiencyVsAmplification,
  efficiencyVsAmplificationPromptBlock,
  appendEfficiencyVsAmplificationPrompt
} = require('../src/efficiency-vs-amplification.js');

test('classifyEfficiencyVsAmplification ignores empty and unrelated prompts', () => {
  assert.equal(classifyEfficiencyVsAmplification('').applies, false);
  const result = classifyEfficiencyVsAmplification('Refactor the settings route and run the unit tests');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'not an efficiency or replacement claim');
  assert.equal(efficiencyVsAmplificationPromptBlock('Refactor the settings route and run the unit tests'), '');
});

test('classifyEfficiencyVsAmplification flags efficiency-as-replacement framing', () => {
  const result = classifyEfficiencyVsAmplification('Build a tool to replace the human so we can be more efficient');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'replacement-framing');
  assert.ok(result.signals.replacement >= 1);
});

test('classifyEfficiencyVsAmplification flags headcount reduction framing', () => {
  const result = classifyEfficiencyVsAmplification('This agent lets us reduce headcount on the ops team');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'replacement-framing');
  assert.ok(result.signals.replacement >= 1);
});

test('classifyEfficiencyVsAmplification flags an efficiency-only value claim', () => {
  const result = classifyEfficiencyVsAmplification('Make the onboarding process more efficient and reduce costs');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'efficiency-only-framing');
  assert.ok(result.signals.efficiency >= 2);
});

test('classifyEfficiencyVsAmplification does not nag when person-amplification is already framed', () => {
  const message = 'Reduce headcount — we want to amplify the team and keep the human in the loop with a review gate';
  const result = classifyEfficiencyVsAmplification(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'person-amplification frame already present');
});

test('classifyEfficiencyVsAmplification ignores a weak efficiency mention', () => {
  const result = classifyEfficiencyVsAmplification('This should be faster');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'weak efficiency signal');
});

test('efficiencyVsAmplificationPromptBlock names the axis, the rider decision and the verdict', () => {
  const block = efficiencyVsAmplificationPromptBlock('Replace the manual step so we can be more efficient');
  assert.match(block, /EFFICIENCY-VS-AMPLIFICATION CHECK/);
  assert.match(block, /Value axis:/);
  assert.match(block, /Amplified capacity:/);
  assert.match(block, /rider's decision/);
  assert.match(block, /Structure supplied:/);
  assert.match(block, /Measurement:/);
  assert.match(block, /No riderless machine:/);
  assert.match(block, /Verdict:/);
});

test('efficiencyVsAmplificationPromptBlock emits real newlines, not literal backslash-n', () => {
  const block = efficiencyVsAmplificationPromptBlock('Replace the manual step so we can be more efficient');
  assert.equal((block.match(/\\n/g) || []).length, 0);
  assert.ok((block.match(/\n/g) || []).length >= 8);
});

test('appendEfficiencyVsAmplificationPrompt preserves the original request first', () => {
  const message = 'We want to do more with less on client reports';
  const augmented = appendEfficiencyVsAmplificationPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[EFFICIENCY-VS-AMPLIFICATION CHECK\]/);
});

test('appendEfficiencyVsAmplificationPrompt is a no-op on unrelated prompts', () => {
  assert.equal(appendEfficiencyVsAmplificationPrompt('Deploy the new build'), 'Deploy the new build');
});
