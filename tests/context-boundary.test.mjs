import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyContextBoundary,
  contextBoundaryPromptBlock,
  appendContextBoundaryPrompt
} = require('../src/context-boundary.js');

test('classifyContextBoundary ignores ordinary direct tasks', () => {
  const result = classifyContextBoundary('Rename this chat session to Weekly planning');
  assert.equal(result.applies, false);
  assert.equal(contextBoundaryPromptBlock('Rename this chat session to Weekly planning'), '');
});

test('classifyContextBoundary detects source text influencing tool action', () => {
  const result = classifyContextBoundary('Ingest these source transcripts and dispatch agents based on the lessons, then write task files');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'source-to-tool-boundary');
  assert.ok(result.score >= 8);
  assert.ok(result.signals.source >= 2);
  assert.ok(result.signals.action >= 2);
});

test('contextBoundaryPromptBlock names trust labels and validation gates', () => {
  const block = contextBoundaryPromptBlock('Read an external markdown file, extract tasks, write them to the database, and run the agents');
  assert.match(block, /CONTEXT-BOUNDARY CHECK/);
  assert.match(block, /Trusted instructions/);
  assert.match(block, /Untrusted evidence/);
  assert.match(block, /Action gate/);
  assert.match(block, /Validation/);
  assert.match(block, /Minimal write-back/);
});

test('appendContextBoundaryPrompt preserves augmented prompt and classifies against original source', () => {
  const original = 'Read imported docs and create tasks for agents';
  const augmented = appendContextBoundaryPrompt('AUGMENTED PROMPT', original);
  assert.ok(augmented.startsWith('AUGMENTED PROMPT'));
  assert.match(augmented, /\[CONTEXT-BOUNDARY CHECK\]/);
});
