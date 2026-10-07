import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyAiWorkflowLadder,
  aiWorkflowLadderPromptBlock,
  appendAiWorkflowLadderPrompt
} = require('../src/ai-workflow-ladder.js');

test('classifyAiWorkflowLadder ignores empty and ordinary operational prompts', () => {
  assert.equal(classifyAiWorkflowLadder('').applies, false);
  const result = classifyAiWorkflowLadder('Restart the dashboard server and check the logs');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no AI/workflow signal');
  assert.equal(aiWorkflowLadderPromptBlock('Restart the dashboard server and check the logs'), '');
});

test('classifyAiWorkflowLadder detects AI learning path requests', () => {
  const result = classifyAiWorkflowLadder('Create a course that teaches our ops team how to learn AI automation from zero');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'ai-learning-path');
  assert.ok(result.signals.ai >= 2);
  assert.ok(result.signals.learning >= 2);
});

test('classifyAiWorkflowLadder detects workflow promotion requests', () => {
  const result = classifyAiWorkflowLadder('Turn this manual client reporting process into an AI agent workflow we can deploy');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'workflow-promotion-path');
  assert.ok(result.signals.build >= 2);
});

test('classifyAiWorkflowLadder does not nag when ladder frame already exists', () => {
  const message = 'Build the AI workflow by naming the current rung, skill file, workbench, routing map, stage artifacts, deterministic script, and maintenance check';
  const result = classifyAiWorkflowLadder(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'operator already supplied ladder/promotion frame');
});

test('aiWorkflowLadderPromptBlock asks for rung artifact separation split discipline and proof', () => {
  const block = aiWorkflowLadderPromptBlock('Help our team learn AI and build a workflow for finance reporting');
  assert.match(block, /AI-WORKFLOW LADDER CHECK/);
  assert.match(block, /Current rung/);
  assert.match(block, /Next promotion artifact/);
  assert.match(block, /Separation/);
  assert.match(block, /Split discipline/);
  assert.match(block, /fresh-session/);
});

test('appendAiWorkflowLadderPrompt preserves original request first', () => {
  const message = 'Design an AI workflow onboarding path for new analyst agents';
  const augmented = appendAiWorkflowLadderPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[AI-WORKFLOW LADDER CHECK\]/);
});
