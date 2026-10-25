import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyHandBackSurface,
  handBackSurfacePromptBlock,
  appendHandBackSurfacePrompt
} = require('../src/hand-back-surface.js');

test('classifyHandBackSurface ignores empty and non-surface prompts', () => {
  assert.equal(classifyHandBackSurface('').applies, false);
  const result = classifyHandBackSurface('Refactor the settings route and run the unit tests');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'not a human-surface request');
  assert.equal(handBackSurfacePromptBlock('Refactor the settings route and run the unit tests'), '');
});

test('classifyHandBackSurface does not match short tokens as substrings', () => {
  // "build", "quick", "continue" contain "ui" as a substring but not as a token.
  const result = classifyHandBackSurface('Build the quick continue guide');
  assert.equal(result.applies, false);
});

test('classifyHandBackSurface flags an explicit UI request', () => {
  const result = classifyHandBackSurface('Redesign the dashboard so operators can see run status');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'explicit-surface');
  assert.ok(result.signals.explicit >= 1);
});

test('classifyHandBackSurface flags an onboarding surface', () => {
  const result = classifyHandBackSurface('Rework the onboarding screen for new operators');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'explicit-surface');
});

test('classifyHandBackSurface flags an implied friction request', () => {
  const result = classifyHandBackSurface('Make the approval step easier to use and reduce friction');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'implied-surface');
});

test('classifyHandBackSurface does not nag when the frame is already named', () => {
  const message = 'Redesign the dashboard UI: name the hand-back line, the lower layers, and the failure mode';
  const result = classifyHandBackSurface(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'hand-back surface already framed');
});

test('handBackSurfacePromptBlock names the hand-back surface parts', () => {
  const block = handBackSurfacePromptBlock('Improve the settings screen');
  assert.match(block, /HAND-BACK SURFACE CHECK/);
  assert.match(block, /Who the capability is handed back to:/);
  assert.match(block, /The stack the surface hides:/);
  assert.match(block, /The deliberate affordance decisions:/);
  assert.match(block, /The hand-back line:/);
  assert.match(block, /Failure visibility:/);
  assert.match(block, /Judgement:/);
});

test('appendHandBackSurfacePrompt preserves the original request first', () => {
  const message = 'Build a one-click export button';
  const augmented = appendHandBackSurfacePrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[HAND-BACK SURFACE CHECK\]/);
});
