import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyFanOutPartitionability,
  fanOutPartitionabilityPromptBlock,
  appendFanOutPartitionabilityPrompt
} = require('../src/fan-out-partitionability.js');

test('classifyFanOutPartitionability ignores empty and unrelated prompts', () => {
  assert.equal(classifyFanOutPartitionability('').applies, false);
  const result = classifyFanOutPartitionability('Summarize the meeting notes and send a digest');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no parallel/fan-out intent');
  assert.equal(fanOutPartitionabilityPromptBlock('Summarize the meeting notes and send a digest'), '');
});

test('classifyFanOutPartitionability does not match tokens as substrings', () => {
  // 'parallel' inside 'parallelize' is a distinct word; 'work' inside 'network'.
  const result = classifyFanOutPartitionability('The network is stable and parallel parking is fine');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'parallel intent without a workload context');
});

test('classifyFanOutPartitionability flags an explicit parallel fan-out request', () => {
  const result = classifyFanOutPartitionability('Run the security audit across multiple agents in parallel');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'explicit-parallel-fan-out');
  assert.ok(result.signals.parallelism >= 2);
  assert.ok(result.signals.workload >= 1);
});

test('classifyFanOutPartitionability flags an implied fan-out request', () => {
  const result = classifyFanOutPartitionability('Fan out the research before writing the brief');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'implied-fan-out');
  assert.ok(result.signals.parallelism >= 1);
});

test('classifyFanOutPartitionability does not fire on parallel intent without a workload', () => {
  const result = classifyFanOutPartitionability('These two lines run in parallel');
  assert.equal(result.applies, false);
});

test('classifyFanOutPartitionability does not nag when partitionability is already framed', () => {
  const message = 'Run the scans in parallel on independent files with a non-overlapping ownership map';
  const result = classifyFanOutPartitionability(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'partitionability already framed');
});

test('fanOutPartitionabilityPromptBlock names the partitionability parts', () => {
  const block = fanOutPartitionabilityPromptBlock('Fan out this codebase review to multiple agents in parallel');
  assert.match(block, /FAN-OUT PARTITIONABILITY CHECK/);
  assert.match(block, /Independent units:/);
  assert.match(block, /Ownership map:/);
  assert.match(block, /Coordination edges:/);
  assert.match(block, /Coupled core:/);
  assert.match(block, /Review is not a slice:/);
  assert.match(block, /Progress metric:/);
  assert.match(block, /Verdict:/);
});

test('appendFanOutPartitionabilityPrompt preserves the original request first', () => {
  const message = 'Spawn several agents in parallel to sweep the backlog';
  const augmented = appendFanOutPartitionabilityPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[FAN-OUT PARTITIONABILITY CHECK\]/);
});

test('appendFanOutPartitionabilityPrompt is a no-op for unrelated prompts', () => {
  const message = 'Rename the column header';
  assert.equal(appendFanOutPartitionabilityPrompt(message), message);
});
