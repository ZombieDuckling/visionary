import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyPortableInstructionAsset,
  portableInstructionAssetPromptBlock,
  appendPortableInstructionAssetPrompt
} = require('../src/portable-instruction-asset.js');

test('classifyPortableInstructionAsset ignores ordinary task text', () => {
  const result = classifyPortableInstructionAsset('Summarize this report and add three bullet points');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no workflow/instruction asset signal');
  assert.equal(portableInstructionAssetPromptBlock('Summarize this report'), '');
});

test('classifyPortableInstructionAsset detects wrapper-first agent build requests', () => {
  const result = classifyPortableInstructionAsset('Build a LangGraph agent wrapper for our support workflow that runs in Claude and OpenAI');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'wrapper-to-portable-workflow');
  assert.ok(result.score >= 12);
  assert.ok(result.signals.wrapper >= 3);
});

test('classifyPortableInstructionAsset detects explicit portability contracts', () => {
  const result = classifyPortableInstructionAsset('Create a portable model-agnostic runbook with files, tools, context, review checkpoint, and fallback provider assumptions');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'portable-runtime-contract');
  assert.ok(result.signals.portable >= 5);
});

test('portableInstructionAssetPromptBlock names contract, instructions, tools, runtime, review, and proof', () => {
  const block = portableInstructionAssetPromptBlock('Package an agent workflow for Cursor/Codex with files, tools, fallback, and reviewer handoff');
  assert.match(block, /PORTABLE-INSTRUCTION ASSET CHECK/);
  assert.match(block, /Outcome contract/);
  assert.match(block, /Model-agnostic instructions/);
  assert.match(block, /Reachable context\/tools/);
  assert.match(block, /Runtime assumptions/);
  assert.match(block, /Review checkpoint/);
  assert.match(block, /Portability proof/);
});

test('appendPortableInstructionAssetPrompt preserves original request first', () => {
  const message = 'Design an agent wrapper around this onboarding playbook for Claude and Hermes';
  const augmented = appendPortableInstructionAssetPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[PORTABLE-INSTRUCTION ASSET CHECK\]/);
});
