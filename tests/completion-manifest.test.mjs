import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyCompletionManifest,
  completionManifestPromptBlock,
  appendCompletionManifestPrompt
} = require('../src/completion-manifest.js');

test('classifyCompletionManifest ignores one-off operational prompts', () => {
  const result = classifyCompletionManifest('Restart the dashboard server and check the health endpoint');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no batch/inventory signal');
  assert.equal(completionManifestPromptBlock('Restart the dashboard server and check the health endpoint'), '');
});

test('classifyCompletionManifest detects manifest closeout work', () => {
  const result = classifyCompletionManifest('Refresh the video channel inventory, process all remaining entries, update the manifest and coverage log, and close the backlog');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'manifest-closeout');
  assert.ok(result.score >= 8);
  assert.ok(result.signals.batch >= 3);
  assert.ok(result.signals.completion >= 2);
  assert.ok(result.signals.tracking >= 2);
});

test('classifyCompletionManifest detects batch coverage checks', () => {
  const result = classifyCompletionManifest('Process the archive batch and finish any unprocessed records');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'batch-coverage-check');
  assert.ok(result.signals.batch >= 2);
});

test('classifyCompletionManifest does not nag when completion frame already exists', () => {
  const message = 'Run the manifest check, report processed_count, total count, unprocessed list, coverage check, and verification command output';
  const result = classifyCompletionManifest(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'operator already supplied completion-manifest frame');
});

test('completionManifestPromptBlock asks for inventory counts coverage state and verification', () => {
  const block = completionManifestPromptBlock('Ingest the dataset archive, update the index, and finish the remaining items');
  assert.match(block, /COMPLETION-MANIFEST CHECK/);
  assert.match(block, /Inventory source/);
  assert.match(block, /Count reconciliation/);
  assert.match(block, /Coverage notes/);
  assert.match(block, /State update/);
  assert.match(block, /Verification/);
});

test('appendCompletionManifestPrompt preserves original request first', () => {
  const message = 'Process all remaining channel videos and close the manifest';
  const augmented = appendCompletionManifestPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[COMPLETION-MANIFEST CHECK\]/);
});
