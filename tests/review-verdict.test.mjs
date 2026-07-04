// Unit tests for src/review-verdict.js — parseVerdict(output)
// Run with: node --test tests/review-verdict.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { parseVerdict } = require(resolve(__dirname, '../src/review-verdict.js'));

test('APPROVE line: returns APPROVE with detail', function () {
  var result = parseVerdict('APPROVE: the deliverable looks good');
  assert.equal(result.verdict, 'APPROVE');
  assert.equal(result.detail, 'the deliverable looks good');
});

test('REJECT line: returns REJECT with detail', function () {
  var result = parseVerdict('REJECT: missing error handling on the auth route');
  assert.equal(result.verdict, 'REJECT');
  assert.equal(result.detail, 'missing error handling on the auth route');
});

test('Rubric echoed later in text: first structured line wins', function () {
  // Reviewer echoes the rubric before answering — only the first match wins.
  var output = 'I will now evaluate the work.\n'
    + 'APPROVE: <one-line summary of what was delivered>\n'
    + 'REJECT: <specific issues that need fixing>\n'
    + 'APPROVE: actual verdict here';
  var result = parseVerdict(output);
  assert.equal(result.verdict, 'APPROVE');
  // first match detail is the rubric placeholder text
  assert.equal(result.detail, '<one-line summary of what was delivered>');
});

test('Verdict not on first line: still found', function () {
  var output = 'Here is my review of the work.\n\nAfter careful examination:\n\nAPPROVE: task completed correctly';
  var result = parseVerdict(output);
  assert.equal(result.verdict, 'APPROVE');
  assert.equal(result.detail, 'task completed correctly');
});

test('No verdict at all: returns null with empty detail', function () {
  var result = parseVerdict('The work seems fine but I cannot make a determination right now.');
  assert.equal(result.verdict, null);
  assert.equal(result.detail, '');
});

test('Lowercase approve: normalised to uppercase APPROVE', function () {
  var result = parseVerdict('approve: looks great to me');
  assert.equal(result.verdict, 'APPROVE');
  assert.equal(result.detail, 'looks great to me');
});

test('Lowercase reject: normalised to uppercase REJECT', function () {
  var result = parseVerdict('reject: multiple bugs found');
  assert.equal(result.verdict, 'REJECT');
  assert.equal(result.detail, 'multiple bugs found');
});

test('Extra whitespace around colon: trimmed correctly', function () {
  var result = parseVerdict('APPROVE  :   well done on the implementation');
  assert.equal(result.verdict, 'APPROVE');
  assert.equal(result.detail, 'well done on the implementation');
});

test('Empty string input: returns null', function () {
  var result = parseVerdict('');
  assert.equal(result.verdict, null);
  assert.equal(result.detail, '');
});

test('Non-string input: returns null gracefully', function () {
  var result = parseVerdict(null);
  assert.equal(result.verdict, null);
  assert.equal(result.detail, '');
});

test('Detail trimmed and capped at 500 chars', function () {
  var long = 'x'.repeat(600);
  var result = parseVerdict('REJECT: ' + long);
  assert.equal(result.verdict, 'REJECT');
  assert.equal(result.detail.length, 500);
});
