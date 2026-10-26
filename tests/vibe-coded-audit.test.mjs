import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyVibeCodedAudit,
  vibeCodedAuditPromptBlock,
  appendVibeCodedAuditPrompt
} = require('../src/vibe-coded-audit.js');

test('classifyVibeCodedAudit ignores empty and unrelated prompts', () => {
  assert.equal(classifyVibeCodedAudit('').applies, false);
  const result = classifyVibeCodedAudit('Summarize the meeting notes and send a digest');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'not a software-audit request');
  assert.equal(vibeCodedAuditPromptBlock('Summarize the meeting notes and send a digest'), '');
});

test('classifyVibeCodedAudit does not match short tokens as substrings', () => {
  // 'item', 'capital', 'apparent' contain 'it'/'api'/'app' as substrings only.
  const result = classifyVibeCodedAudit('List the capital cities item apparent');
  assert.equal(result.applies, false);
});

test('classifyVibeCodedAudit flags an explicit vibe-coded audit request', () => {
  const result = classifyVibeCodedAudit('Open Claw vibe coded this app — audit it');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'explicit-vibe-coded');
  assert.ok(result.signals.vibe >= 1);
});

test('classifyVibeCodedAudit flags an implied software-audit request', () => {
  const result = classifyVibeCodedAudit('Review the codebase and tell me if it is safe to ship');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'implied-software-audit');
  assert.ok(result.signals.auditIntent >= 1);
  assert.ok(result.signals.softwareContext >= 1);
});

test('classifyVibeCodedAudit flags a bare check-for-secrets request', () => {
  const result = classifyVibeCodedAudit('Check for secrets in the repo before launch');
  assert.equal(result.applies, true);
});

test('classifyVibeCodedAudit does not fire on audit intent without software context', () => {
  const result = classifyVibeCodedAudit('Audit the marketing spend next quarter');
  assert.equal(result.applies, false);
});

test('classifyVibeCodedAudit does not nag when audit gates are already framed', () => {
  const message = 'Audit this app: scan for secrets, check Git history, map public routes, and do a threat model';
  const result = classifyVibeCodedAudit(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'vibe-coded audit already framed');
});

test('vibeCodedAuditPromptBlock names the audit parts', () => {
  const block = vibeCodedAuditPromptBlock('Vibe coded this app — is it safe to launch?');
  assert.match(block, /VIBE-CODED SOFTWARE AUDIT/);
  assert.match(block, /Secrets and key history:/);
  assert.match(block, /Managed auth\/security primitives:/);
  assert.match(block, /Public\/private route boundaries:/);
  assert.match(block, /Generated artifacts reviewed as context:/);
  assert.match(block, /External provider\/deployment boundary:/);
  assert.match(block, /Human threat model:/);
  assert.match(block, /Report:/);
});

test('appendVibeCodedAuditPrompt preserves the original request first', () => {
  const message = 'Audit the app before we ship it to the client';
  const augmented = appendVibeCodedAuditPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[VIBE-CODED SOFTWARE AUDIT\]/);
});

test('appendVibeCodedAuditPrompt is a no-op for unrelated prompts', () => {
  const message = 'Rename the column header';
  assert.equal(appendVibeCodedAuditPrompt(message), message);
});
