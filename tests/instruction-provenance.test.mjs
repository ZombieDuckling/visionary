import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyInstructionProvenance,
  instructionProvenancePromptBlock,
  appendInstructionProvenancePrompt
} = require('../src/instruction-provenance.js');

test('classifyInstructionProvenance ignores empty and unrelated prompts', () => {
  assert.equal(classifyInstructionProvenance('').applies, false);
  const result = classifyInstructionProvenance('Summarize the meeting notes and send a digest');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no inherited/borrowed-instruction signal');
  assert.equal(instructionProvenancePromptBlock('Summarize the meeting notes and send a digest'), '');
});

test('classifyInstructionProvenance needs an instruction object, not just a copy signal', () => {
  const result = classifyInstructionProvenance('Copy the report to /tmp and reuse the header');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'inheritance signal without an instruction object');
});

test('classifyInstructionProvenance does not match tokens as substrings', () => {
  // 'reuse' inside 'reused' is fine, but 'template' inside nothing; ensure
  // 'based on' does not match bare 'based'.
  const result = classifyInstructionProvenance('The build is based on a stable network');
  assert.equal(result.applies, false);
});

test('classifyInstructionProvenance flags adopting a repo-authored prompt file', () => {
  const result = classifyInstructionProvenance('Use this prompt from the repo to write the newsletter');
  assert.equal(result.applies, true);
  assert.ok(result.signals.inherited >= 1);
  assert.ok(result.signals.instructionObject >= 1);
});

test('classifyInstructionProvenance flags copying another team\'s skill/workflow', () => {
  const result = classifyInstructionProvenance('Copy the existing skill workflow from the other repo');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'multi-instruction-adoption');
});

test('classifyInstructionProvenance does not nag when provenance is already framed', () => {
  const message = 'Reuse their template but record instruction provenance and our own opinionated procedure';
  const result = classifyInstructionProvenance(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'instruction provenance already framed');
});

test('instructionProvenancePromptBlock names the provenance parts', () => {
  const block = instructionProvenancePromptBlock('Adapt this template prompt for the audit');
  assert.match(block, /INSTRUCTION PROVENANCE CHECK/);
  assert.match(block, /Instruction author:/);
  assert.match(block, /Opinionated parts:/);
  assert.match(block, /Non-opinionated parts:/);
  assert.match(block, /Verb scope:/);
  assert.match(block, /Drift audit:/);
  assert.match(block, /Verdict:/);
});

test('appendInstructionProvenancePrompt preserves the original request first', () => {
  const message = 'Follow the style guide template you borrowed from the vendor';
  const augmented = appendInstructionProvenancePrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[INSTRUCTION PROVENANCE CHECK\]/);
});

test('appendInstructionProvenancePrompt is a no-op for unrelated prompts', () => {
  const message = 'Rename the column header';
  assert.equal(appendInstructionProvenancePrompt(message), message);
});
