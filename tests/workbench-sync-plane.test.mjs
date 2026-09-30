import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyWorkbenchSyncPlane,
  workbenchSyncPlanePromptBlock,
  appendWorkbenchSyncPlanePrompt
} = require('../src/workbench-sync-plane.js');

test('classifyWorkbenchSyncPlane ignores ordinary folder tasks without connector work', () => {
  const result = classifyWorkbenchSyncPlane('Summarize the docs folder and list the next tasks');
  assert.equal(result.applies, false);
  assert.equal(workbenchSyncPlanePromptBlock('Summarize the docs folder and list the next tasks'), '');
});

test('classifyWorkbenchSyncPlane detects scoped MCP workbench sync', () => {
  const result = classifyWorkbenchSyncPlane('Connect this project workbench through MCP with org permissions, scoped clients, secrets outside the folder, and a review diff');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'scoped-sync-auth-plane');
  assert.ok(result.score >= 14);
  assert.ok(result.signals.workbench >= 1);
  assert.ok(result.signals.connector >= 2);
  assert.ok(result.signals.boundary >= 3);
});

test('classifyWorkbenchSyncPlane detects import/export continuity workbenches', () => {
  const result = classifyWorkbenchSyncPlane('Export the workspace as a zip handoff with a manifest so Claude and Hermes clients can continue from the same files');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'import-export-continuity-plane');
  assert.ok(result.signals.connector >= 3);
});

test('workbenchSyncPlanePromptBlock names portable object, boundaries, manifest, and review surface', () => {
  const block = workbenchSyncPlanePromptBlock('Build an MCP connector that syncs a shared repo workbench with scoped permissions and export manifest');
  assert.match(block, /WORKBENCH-SYNC PLANE CHECK/);
  assert.match(block, /Portable object/);
  assert.match(block, /Copy boundary/);
  assert.match(block, /Scope boundary/);
  assert.match(block, /Secret boundary/);
  assert.match(block, /Import\/export manifest/);
  assert.match(block, /Review surface/);
});

test('appendWorkbenchSyncPlanePrompt preserves original request first', () => {
  const message = 'Sync this repo workbench through MCP and export a manifest for another client';
  const augmented = appendWorkbenchSyncPlanePrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[WORKBENCH-SYNC PLANE CHECK\]/);
});
