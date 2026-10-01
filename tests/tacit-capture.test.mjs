import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyTacitCapture,
  tacitCapturePromptBlock,
  appendTacitCapturePrompt
} = require('../src/tacit-capture.js');

test('classifyTacitCapture ignores plain deterministic checks', () => {
  const result = classifyTacitCapture('Run a checksum, JSON parse, and syntax check on every file');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'deterministic tool check, not tacit work capture');
  assert.equal(tacitCapturePromptBlock('Run a checksum and syntax check'), '');
});

test('classifyTacitCapture detects role workflow automation with tacit judgment', () => {
  const result = classifyTacitCapture('Build an agent workflow for a support manager that uses client nuance, exceptions, examples, and approval review');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'tacit-judgment-capture');
  assert.ok(result.score >= 12);
  assert.ok(result.signals.automation >= 2);
  assert.ok(result.signals.roleWork >= 2);
  assert.ok(result.signals.tacit >= 3);
});

test('tacitCapturePromptBlock asks for written process, tacit residue, examples, mechanism fit, and capture loop', () => {
  const block = tacitCapturePromptBlock('Automate analyst review with examples, exceptions, judgment, and a human approval loop');
  assert.match(block, /TACIT-CAPTURE CHECK/);
  assert.match(block, /Written process/);
  assert.match(block, /Tacit residue/);
  assert.match(block, /Source examples/);
  assert.match(block, /Mechanism fit/);
  assert.match(block, /Capture loop/);
});

test('appendTacitCapturePrompt preserves original request and appends nudge', () => {
  const message = 'Create an AI assistant persona for a sales role using sample calls, preferences, and review feedback';
  const augmented = appendTacitCapturePrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[TACIT-CAPTURE CHECK\]/);
});