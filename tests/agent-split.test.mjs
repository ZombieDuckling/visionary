import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyAgentSplit,
  agentSplitPromptBlock,
  appendAgentSplitPrompt
} = require('../src/agent-split.js');

test('classifyAgentSplit ignores ordinary implementation work', () => {
  const result = classifyAgentSplit('Fix the overview API stale run cleanup and run tests');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'not agent/persona split shaped');
  assert.equal(agentSplitPromptBlock('Fix the overview API stale run cleanup and run tests'), '');
});

test('classifyAgentSplit detects multi-agent role design', () => {
  const result = classifyAgentSplit('Design a team of agents with specialist roles, routing, handoffs, and reviewer approval');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'multi-agent-role-split');
  assert.ok(result.signals.agents >= 3);
  assert.ok(result.signals.splits >= 3);
});

test('classifyAgentSplit detects workbench-before-agent-split cases', () => {
  const result = classifyAgentSplit('Create assistant personas for the sales workflow with context folders, routing files, permissions, and token cost limits');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'workbench-before-agent-split');
  assert.ok(result.signals.workbench >= 3);
});

test('agentSplitPromptBlock requires boundaries, simpler layers, contracts, and consolidation', () => {
  const block = agentSplitPromptBlock('Map agents and roles for an operations workflow');
  assert.match(block, /AGENT-SPLIT CHECK/);
  assert.match(block, /Needed boundary/);
  assert.match(block, /Simpler layer/);
  assert.match(block, /Role contract/);
  assert.match(block, /Consolidation rule/);
});

test('appendAgentSplitPrompt preserves the original request first', () => {
  const message = 'Build agent personas for a client onboarding workflow with task handoffs';
  const augmented = appendAgentSplitPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[AGENT-SPLIT CHECK\]/);
});
