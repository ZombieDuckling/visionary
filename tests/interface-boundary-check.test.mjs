import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyInterfaceBoundaryCheck,
  interfaceBoundaryCheckPromptBlock,
  appendInterfaceBoundaryCheckPrompt
} = require('../src/interface-boundary-check.js');

test('classifyInterfaceBoundaryCheck ignores ordinary writing work', () => {
  const result = classifyInterfaceBoundaryCheck('Write a short weekly update for the team');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no interface/API/tool signal');
  assert.equal(interfaceBoundaryCheckPromptBlock('Write a short weekly update for the team'), '');
});

test('classifyInterfaceBoundaryCheck detects permission and secret boundaries', () => {
  const result = classifyInterfaceBoundaryCheck('Build an API integration that uses scoped auth tokens and verifies the response payload');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'permission-and-secret-boundary');
  assert.ok(result.score >= 13);
  assert.ok(result.signals.interface >= 2);
  assert.ok(result.signals.boundary >= 2);
});

test('classifyInterfaceBoundaryCheck detects verification boundaries', () => {
  const result = classifyInterfaceBoundaryCheck('Add a CLI adapter with smoke tests, read-back validation, healthcheck logs, and retry status handling');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'verification-boundary');
  assert.ok(result.signals.verification >= 5);
});

test('interfaceBoundaryCheckPromptBlock names contract, inputs, secrets, verification, and failure mode', () => {
  const block = interfaceBoundaryCheckPromptBlock('Wire the webhook endpoint with request schema, scoped credentials, and smoke test verification');
  assert.match(block, /INTERFACE BOUNDARY CHECK/);
  assert.match(block, /Contract surface/);
  assert.match(block, /Inputs and outputs/);
  assert.match(block, /Permission and secret boundary/);
  assert.match(block, /Boundary verification/);
  assert.match(block, /Failure mode/);
});

test('appendInterfaceBoundaryCheckPrompt preserves original request first', () => {
  const message = 'Create the API route contract with request payload, error response, and read-back test';
  const augmented = appendInterfaceBoundaryCheckPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[INTERFACE BOUNDARY CHECK\]/);
});
