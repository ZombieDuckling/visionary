import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyOpinionStandard,
  opinionStandardPromptBlock,
  appendOpinionStandardPrompt
} = require('../src/opinion-standard.js');

test('classifyOpinionStandard ignores empty and unrelated operational prompts', () => {
  assert.equal(classifyOpinionStandard('').applies, false);
  const result = classifyOpinionStandard('Move task 19 to review after the dispatch finishes');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no taste or standard signal');
  assert.equal(opinionStandardPromptBlock('Move task 19 to review after the dispatch finishes'), '');
});

test('classifyOpinionStandard does not nag when standards are only mentioned passively', () => {
  const result = classifyOpinionStandard('Read the existing brand standards before editing the page');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'standard mentioned without encoding or review work');
});

test('classifyOpinionStandard detects codified judgment work', () => {
  const result = classifyOpinionStandard('Codify Josh\'s design taste and preferences into reusable review instructions');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'codified-judgment');
  assert.ok(result.signals.standard >= 2);
  assert.ok(result.signals.codify >= 1);
});

test('classifyOpinionStandard detects style guides and review rubrics', () => {
  const styleGuide = classifyOpinionStandard('Create a brand style guide with voice and tone examples');
  assert.equal(styleGuide.applies, true);
  assert.equal(styleGuide.layer, 'taste-guide');

  const rubric = classifyOpinionStandard('Build a scoring rubric and acceptance criteria for approving agent outputs');
  assert.equal(rubric.applies, true);
  assert.equal(rubric.layer, 'review-rubric');
});

test('opinionStandardPromptBlock names reusable standard requirements', () => {
  const block = opinionStandardPromptBlock('Automate my opinions into a quality review rubric');
  assert.match(block, /OPINION-STANDARD CHECK/);
  assert.match(block, /Source standard/);
  assert.match(block, /Decision boundary/);
  assert.match(block, /Examples and anti-examples/);
  assert.match(block, /Review rubric/);
  assert.match(block, /Revision path/);
});

test('appendOpinionStandardPrompt preserves original request first', () => {
  const message = 'Encode our content taste as a reusable checklist';
  const augmented = appendOpinionStandardPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[OPINION-STANDARD CHECK\]/);
});
