import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyConsentDisclosure,
  consentDisclosurePromptBlock,
  appendConsentDisclosurePrompt
} = require('../src/consent-disclosure.js');

test('classifyConsentDisclosure ignores ordinary media work', () => {
  const result = classifyConsentDisclosure('Edit the podcast intro and export the transcript');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no synthetic identity/media signal');
  assert.equal(consentDisclosurePromptBlock('Edit the podcast intro and export the transcript'), '');
});

test('classifyConsentDisclosure detects voice cloning with person boundary', () => {
  const result = classifyConsentDisclosure('Create an AI voice clone of the founder for a customer onboarding video');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'voice-consent-boundary');
  assert.ok(result.score >= 8);
  assert.ok(result.signals.media >= 1);
  assert.ok(result.signals.identity >= 2);
});

test('classifyConsentDisclosure detects likeness disclosure boundary', () => {
  const result = classifyConsentDisclosure('Generate a deepfake talking head using the client likeness and publish it as an endorsement');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'likeness-disclosure-boundary');
  assert.ok(result.signals.media >= 2);
  assert.ok(result.signals.identity >= 2);
});

test('classifyConsentDisclosure does not nag when consent frame already exists', () => {
  const message = 'Build the synthetic voice demo with consent, approval, disclosure, label, retention, and revocation rules';
  const result = classifyConsentDisclosure(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'operator already supplied consent/disclosure frame');
});

test('consentDisclosurePromptBlock names authority, consent, disclosure, data boundary, and misuse review', () => {
  const block = consentDisclosurePromptBlock('Make an avatar using the employee face and voice for training videos');
  assert.match(block, /CONSENT \+ DISCLOSURE CHECK/);
  assert.match(block, /Subject authority/);
  assert.match(block, /Consent evidence/);
  assert.match(block, /Disclosure surface/);
  assert.match(block, /Data boundary/);
  assert.match(block, /Misuse review/);
});

test('appendConsentDisclosurePrompt preserves original request first', () => {
  const message = 'Create a cloned voice testimonial from the customer recording';
  const augmented = appendConsentDisclosurePrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[CONSENT \+ DISCLOSURE CHECK\]/);
});
