import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyFolderProductBaseline,
  folderProductBaselinePromptBlock,
  appendFolderProductBaselinePrompt
} = require('../src/folder-product-baseline.js');

test('classifyFolderProductBaseline ignores ordinary operational tasks', () => {
  const result = classifyFolderProductBaseline('Move task 12 to review after the smoke test passes');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'not product/workbench build shaped');
  assert.equal(folderProductBaselinePromptBlock('Move task 12 to review after the smoke test passes'), '');
});

test('classifyFolderProductBaseline detects agent dashboard product work', () => {
  const result = classifyFolderProductBaseline('Build a dashboard for AI agents with custom roles, markdown context, and shared artifacts');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'deployment-and-governance-layer');
  assert.ok(result.score >= 10);
  assert.ok(result.signals.build >= 2);
  assert.ok(result.signals.workflow >= 3);
  assert.ok(result.signals.deployment >= 2);
});

test('classifyFolderProductBaseline detects software after folder baseline work', () => {
  const result = classifyFolderProductBaseline('Create an AI workflow app with a database, API, scheduler, and document workbench');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'software-after-folder-baseline');
  assert.ok(result.signals.software >= 3);
});

test('folderProductBaselinePromptBlock names baseline, product gap, boundary, and verification', () => {
  const block = folderProductBaselinePromptBlock('Prototype a SaaS platform for role-based AI workbench routing');
  assert.match(block, /FOLDER-PRODUCT BASELINE CHECK/);
  assert.match(block, /Folder baseline/);
  assert.match(block, /Product gap/);
  assert.match(block, /Build boundary/);
  assert.match(block, /Verification/);
});

test('appendFolderProductBaselinePrompt preserves original request first', () => {
  const message = 'Build an AI agent platform for teams with roles, permissions, and artifacts';
  const augmented = appendFolderProductBaselinePrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[FOLDER-PRODUCT BASELINE CHECK\]/);
});
