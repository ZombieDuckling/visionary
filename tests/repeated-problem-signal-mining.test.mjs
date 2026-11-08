import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyRepeatedProblemSignalMining,
  repeatedProblemSignalMiningPromptBlock,
  appendRepeatedProblemSignalMiningPrompt
} = require('../src/repeated-problem-signal-mining.js');

test('classifyRepeatedProblemSignalMining ignores empty and ordinary execution prompts', () => {
  assert.equal(classifyRepeatedProblemSignalMining('').applies, false);
  const result = classifyRepeatedProblemSignalMining('Restart the dashboard server and check the logs');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no roadmap/what-to-build-next signal');
  assert.equal(repeatedProblemSignalMiningPromptBlock('Restart the dashboard server and check the logs'), '');
});

test('classifyRepeatedProblemSignalMining ignores a roadmap decision with no user/community source', () => {
  const result = classifyRepeatedProblemSignalMining('Decide the product roadmap for the next quarter and prioritize features');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'build decision stated without a user/community problem source');
});

test('classifyRepeatedProblemSignalMining ignores a one-off problem with no repetition framing', () => {
  const result = classifyRepeatedProblemSignalMining('A user reported a bug in the backlog, prioritize it');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'problem source named without a repeated-signal framing');
});

test('classifyRepeatedProblemSignalMining fires on a roadmap sourced from repeated user problems', () => {
  const result = classifyRepeatedProblemSignalMining('Users report backlog problems, so prioritize what to build next from the recurring requests');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'roadmap-from-signal');
  assert.ok(result.signals.roadmap >= 1);
  assert.ok(result.signals.source >= 1);
  assert.ok(result.signals.repetition >= 1);
});

test('classifyRepeatedProblemSignalMining fires a full signal review on a heavy repeated-community signal', () => {
  const result = classifyRepeatedProblemSignalMining('Our community members report the same friction repeatedly and keep asking for the same feature, so we prioritize the roadmap');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'repeated-problem-spec');
});

test('classifyRepeatedProblemSignalMining steps back when the operator already framed a repeated-problem signal', () => {
  const message = 'Treat the repeated problem signal as a ranked list demand signal, then pick the roadmap item';
  const result = classifyRepeatedProblemSignalMining(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'operator already framed the roadmap as a repeated-problem signal');
});

test('repeatedProblemSignalMiningPromptBlock asks for field, ranked problems, requirement and verdict', () => {
  const block = repeatedProblemSignalMiningPromptBlock('Users keep reporting the same backlog problems over and over, so prioritize what to build next');
  assert.match(block, /REPEATED-PROBLEM SIGNAL MINING/);
  assert.match(block, /Field \/ community surface/);
  assert.match(block, /Rank the repeated problems/);
  assert.match(block, /Most-repeated problem -> requirement/);
  assert.match(block, /Proof \/ case artifacts/);
  assert.match(block, /talent path/);
  assert.match(block, /Verdict/);
});

test('appendRepeatedProblemSignalMiningPrompt preserves the original request first', () => {
  const message = 'Users keep reporting the same backlog problems over and over, so prioritize what to build next';
  const augmented = appendRepeatedProblemSignalMiningPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[REPEATED-PROBLEM SIGNAL MINING\]/);
});
