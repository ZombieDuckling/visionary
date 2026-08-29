import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyArtifactWorkbench,
  artifactWorkbenchPromptBlock,
  appendArtifactWorkbenchPrompt
} = require('../src/artifact-workbench.js');

test('classifyArtifactWorkbench ignores ordinary non-artifact chat', () => {
  const result = classifyArtifactWorkbench('Ask Scout for a quick market signal summary');
  assert.equal(result.applies, false);
  assert.equal(artifactWorkbenchPromptBlock('Ask Scout for a quick market signal summary'), '');
});

test('classifyArtifactWorkbench detects section-scoped document edits', () => {
  const result = classifyArtifactWorkbench('Edit the onboarding runbook section, show the diff, and leave it in review');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'section-scoped-artifact-edit');
  assert.ok(result.score >= 8);
  assert.ok(result.signals.artifact >= 1);
  assert.ok(result.signals.edit >= 3);
});

test('classifyArtifactWorkbench detects collaborative branching workbenches', () => {
  const result = classifyArtifactWorkbench('Create a branch for the proposal artifact, assign role agents, merge accepted changes, and preserve the source discussion');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'collaborative-artifact-workbench');
  assert.ok(result.signals.collaboration >= 2);
});

test('artifactWorkbenchPromptBlock names artifact, section, ledger, and review requirements', () => {
  const block = artifactWorkbenchPromptBlock('Update the project spec file with agent feedback and record version changes');
  assert.match(block, /ARTIFACT-WORKBENCH CHECK/);
  assert.match(block, /Source discussion/);
  assert.match(block, /Active artifact/);
  assert.match(block, /Bounded role contract/);
  assert.match(block, /Section targeting/);
  assert.match(block, /Change ledger/);
  assert.match(block, /Merge\/review path/);
});

test('appendArtifactWorkbenchPrompt preserves original request first', () => {
  const message = 'Revise the README artifact and include acceptance criteria';
  const augmented = appendArtifactWorkbenchPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[ARTIFACT-WORKBENCH CHECK\]/);
});
