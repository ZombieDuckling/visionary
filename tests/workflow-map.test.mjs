import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyWorkflowMap,
  workflowMapPromptBlock,
  appendWorkflowMapPrompt
} = require('../src/workflow-map.js');

test('classifyWorkflowMap ignores ordinary one-off tasks', () => {
  const result = classifyWorkflowMap('Fix the typo in the README and run the smoke test');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'not team/workflow-memory shaped');
  assert.equal(workflowMapPromptBlock('Fix the typo in the README and run the smoke test'), '');
});

test('classifyWorkflowMap detects team workflow memory work', () => {
  const result = classifyWorkflowMap('Map the sales team intake workflow with roles, source docs, outputs, and approval handoffs');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'workflow-io-map');
  assert.ok(result.score >= 12);
  assert.ok(result.signals.actors >= 2);
  assert.ok(result.signals.workflows >= 3);
  assert.ok(result.signals.io >= 2);
});

test('classifyWorkflowMap detects position-addressed second brain work', () => {
  const result = classifyWorkflowMap('Design a second brain knowledgebase for an ops role using folders, context maps, and source-of-truth files');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'position-addressed-memory-map');
  assert.ok(result.signals.memory >= 4);
});

test('workflowMapPromptBlock names nodes, edges, IO, source state, and verification', () => {
  const block = workflowMapPromptBlock('Create an agent workflow map for customer support roles, inputs, outputs, and review');
  assert.match(block, /WORKFLOW-MAP CHECK/);
  assert.match(block, /Actors\/nodes/);
  assert.match(block, /Actions\/edges/);
  assert.match(block, /Inputs\/outputs/);
  assert.match(block, /Source files\/state/);
  assert.match(block, /Verification/);
});

test('appendWorkflowMapPrompt preserves original request first', () => {
  const message = 'Build a project onboarding workflow for agents and human reviewers with source docs and output artifacts';
  const augmented = appendWorkflowMapPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[WORKFLOW-MAP CHECK\]/);
});
