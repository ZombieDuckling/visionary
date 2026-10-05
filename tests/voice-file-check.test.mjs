import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyVoiceFileCheck,
  voiceFileCheckPromptBlock,
  appendVoiceFileCheckPrompt
} = require('../src/voice-file-check.js');

test('classifyVoiceFileCheck ignores unrelated technical work', () => {
  const result = classifyVoiceFileCheck('Refactor the SQLite API route and run the unit tests');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no content/drafting signal');
  assert.equal(voiceFileCheckPromptBlock('Refactor the SQLite API route and run the unit tests'), '');
});

test('classifyVoiceFileCheck ignores plain content without voice requirements', () => {
  const result = classifyVoiceFileCheck('Draft a factual status note with the deployment commands');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'content request lacks voice/source signal');
});

test('classifyVoiceFileCheck detects voice-sensitive drafting', () => {
  const result = classifyVoiceFileCheck('Rewrite the homepage copy so it sounds like Josh: direct, human, and polished');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'voice-sensitive-draft');
  assert.ok(result.signals.content >= 2);
  assert.ok(result.signals.voice >= 3);
});

test('classifyVoiceFileCheck detects explicit voice-source work', () => {
  const result = classifyVoiceFileCheck('Create a VOICE.md style guide with examples, forbidden phrases, and lint rules for outreach emails');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'explicit-voice-source');
  assert.ok(result.signals.source >= 3);
});

test('voiceFileCheckPromptBlock asks for source examples deterministic checks review and durable corrections', () => {
  const block = voiceFileCheckPromptBlock('Draft client-facing sales page copy in our founder voice with examples');
  assert.match(block, /VOICE-FILE CHECK/);
  assert.match(block, /Voice source/);
  assert.match(block, /Concrete examples/);
  assert.match(block, /Deterministic checks/);
  assert.match(block, /Human judgment/);
  assert.match(block, /Durable correction/);
});

test('appendVoiceFileCheckPrompt preserves original request first', () => {
  const message = 'Write a newsletter intro in Josh\'s voice using the brand examples';
  const augmented = appendVoiceFileCheckPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[VOICE-FILE CHECK\]/);
});
