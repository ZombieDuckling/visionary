import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyMediaProvenance,
  mediaProvenancePromptBlock,
  appendMediaProvenancePrompt
} = require('../src/media-provenance.js');

test('classifyMediaProvenance ignores ordinary non-media dispatches', () => {
  const result = classifyMediaProvenance('Ask Analyst for a quick market summary with sources');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'not generated-media shaped');
  assert.equal(mediaProvenancePromptBlock('Ask Analyst for a quick market summary with sources'), '');
});

test('classifyMediaProvenance detects video provenance work', () => {
  const result = classifyMediaProvenance('Generate four style variants of a product video from source assets and export the final clip');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'video-provenance');
  assert.ok(result.signals.media >= 1);
  assert.ok(result.signals.generation >= 2);
  assert.ok(result.signals.provenance >= 2);
});

test('classifyMediaProvenance detects image provenance work', () => {
  const result = classifyMediaProvenance('Create AI thumbnail images with prompt metadata, original references, and approval notes');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'image-provenance');
});

test('classifyMediaProvenance detects audio provenance work', () => {
  const result = classifyMediaProvenance('Produce a voiceover ad with the script source, model metadata, export files, and review approval');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'audio-provenance');
});

test('classifyMediaProvenance skips requests that already supply the provenance frame', () => {
  const result = classifyMediaProvenance('Generate the clip and include a media provenance manifest with source assets and approval notes');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'operator already supplied media-provenance frame');
});

test('mediaProvenancePromptBlock names source, prompt/spec, metadata, variants, edits, rights, and final package', () => {
  const block = mediaProvenancePromptBlock('Create a generated video campaign with style variants, captions, source files, and final export');
  assert.match(block, /MEDIA-PROVENANCE CHECK/);
  assert.match(block, /Source assets/);
  assert.match(block, /Prompt\/spec ledger/);
  assert.match(block, /Tool\/model metadata/);
  assert.match(block, /Variant folder/);
  assert.match(block, /Deterministic edit layer/);
  assert.match(block, /Rights and approval/);
  assert.match(block, /Final package/);
});

test('appendMediaProvenancePrompt preserves original request first', () => {
  const message = 'Generate a product video with prompt metadata and final export files';
  const augmented = appendMediaProvenancePrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[MEDIA-PROVENANCE CHECK\]/);
});
