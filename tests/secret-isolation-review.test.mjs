import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifySecretIsolation,
  secretIsolationPromptBlock,
  appendSecretIsolationPrompt
} = require('../src/secret-isolation-review.js');

test('classifySecretIsolation ignores empty and ordinary execution prompts', () => {
  assert.equal(classifySecretIsolation('').applies, false);
  assert.equal(classifySecretIsolation('').reason, 'empty message');
  const result = classifySecretIsolation('Restart the dashboard server and check the logs');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no secret/credential in scope');
  assert.equal(secretIsolationPromptBlock('Restart the dashboard server and check the logs'), '');
});

test('classifySecretIsolation ignores a generic token-budget request', () => {
  const result = classifySecretIsolation('Reduce token usage and log the counts for the report');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no secret/credential in scope');
});

test('classifySecretIsolation ignores a bare mention with no handling or boundary risk', () => {
  const result = classifySecretIsolation('The credentials are the topic of this note');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'weak secret-isolation signal');
});

test('classifySecretIsolation fires when a secret is loaded and used', () => {
  const result = classifySecretIsolation('Load the API key from the environment and call the API');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'secret-in-scope-check');
  assert.ok(result.signals.strong >= 1);
});

test('classifySecretIsolation fires a scope review on a multi-credential job', () => {
  const result = classifySecretIsolation('Configure the OAuth client secret and store it in the keychain');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'secret-scope-review');
});

test('classifySecretIsolation fires a boundary review on heavy leak risk', () => {
  const result = classifySecretIsolation("Don't leak the API password into the logs or commit it to git");
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'secret-boundary-review');
  assert.ok(result.signals.risk >= 2);
});

test('classifySecretIsolation fires on a weak term reinforced by handling and risk', () => {
  const result = classifySecretIsolation("Use the auth token from env and don't log it");
  assert.equal(result.applies, true);
});

test('classifySecretIsolation steps back when the operator already framed the isolation', () => {
  const message = 'The API key is secret-isolated: keep out of the prompt and no secret in the repo';
  const result = classifySecretIsolation(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'operator already framed the secret isolation');
});

test('secretIsolationPromptBlock asks for store, boundaries, scope and verdict', () => {
  const block = secretIsolationPromptBlock('Load the API key from the environment and call the API');
  assert.match(block, /SECRET ISOLATION REVIEW/);
  assert.match(block, /Secret in scope/);
  assert.match(block, /Prompt\/chat boundary/);
  assert.match(block, /Artifact boundary/);
  assert.match(block, /Git boundary/);
  assert.match(block, /least privilege/i);
  assert.match(block, /Verification/);
  assert.match(block, /Verdict/);
});

test('appendSecretIsolationPrompt preserves the original request first', () => {
  const message = 'Load the API key from the environment and call the API';
  const augmented = appendSecretIsolationPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[SECRET ISOLATION REVIEW\]/);
});
