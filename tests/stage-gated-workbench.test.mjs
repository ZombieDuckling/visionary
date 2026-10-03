import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyStageGatedWorkbench,
  stageGatedWorkbenchPromptBlock,
  appendStageGatedWorkbenchPrompt
} = require('../src/stage-gated-workbench.js');

test('classifyStageGatedWorkbench ignores ordinary quick requests', () => {
  const result = classifyStageGatedWorkbench('Ask Scout for a quick exchange-rate summary');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'not a generated deliverable workflow');
  assert.equal(stageGatedWorkbenchPromptBlock('Ask Scout for a quick exchange-rate summary'), '');
});

test('classifyStageGatedWorkbench detects media pipelines', () => {
  const result = classifyStageGatedWorkbench('Generate a public product video with transcript metadata, storyboard, preview, and final render');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'media-pipeline');
  assert.ok(result.signals.deliverable >= 2);
  assert.ok(result.signals.complexity >= 3);
});

test('classifyStageGatedWorkbench detects publish package pipelines', () => {
  const result = classifyStageGatedWorkbench('Build the client deck and landing page package with QA review before launch');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'publish-package-pipeline');
});

test('classifyStageGatedWorkbench detects software workbench pipelines', () => {
  const result = classifyStageGatedWorkbench('Create an app prototype workbench with source assets, preview checks, and final export');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'software-workbench-pipeline');
});

test('classifyStageGatedWorkbench skips requests that already specify gate framing', () => {
  const result = classifyStageGatedWorkbench('Build a video with a stage-gate pipeline and human check after each output');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'already stage-gated');
});

test('stageGatedWorkbenchPromptBlock names stages, source, metadata, preview, checks, repairability, and final package', () => {
  const block = stageGatedWorkbenchPromptBlock('Produce a public campaign video package with review and approval');
  assert.match(block, /STAGE-GATED WORKBENCH CHECK/);
  assert.match(block, /Stage table/);
  assert.match(block, /Source first/);
  assert.match(block, /Metadata\/spec before render/);
  assert.match(block, /Preview gate/);
  assert.match(block, /Deterministic checks/);
  assert.match(block, /Repairability/);
  assert.match(block, /Final package/);
});

test('appendStageGatedWorkbenchPrompt preserves original request first', () => {
  const message = 'Build a client deck package with a preview and final export';
  const augmented = appendStageGatedWorkbenchPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[STAGE-GATED WORKBENCH CHECK\]/);
});
