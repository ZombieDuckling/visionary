import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyExecutionEvidenceGate,
  executionEvidenceGatePromptBlock,
  appendExecutionEvidenceGatePrompt
} = require('../src/execution-evidence-gate.js');

test('classifyExecutionEvidenceGate ignores ordinary non-automation status updates', () => {
  const result = classifyExecutionEvidenceGate('Send Josh a quick status update that the client call is done');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no automation/workflow signal');
  assert.equal(executionEvidenceGatePromptBlock('Send Josh a quick status update that the client call is done'), '');
});

test('classifyExecutionEvidenceGate detects running automation with artifact risk', () => {
  const result = classifyExecutionEvidenceGate('The AI automation says running and the report is complete, but verify the output files, logs, and freshness before downstream use');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'human-gated-downstream-use');
  assert.ok(result.score >= 12);
  assert.ok(result.signals.automation >= 2);
  assert.ok(result.signals.status >= 2);
  assert.ok(result.signals.evidence >= 5);
});

test('classifyExecutionEvidenceGate skips prompts that already include an evidence gate', () => {
  const result = classifyExecutionEvidenceGate('For this automation, add a per-step artifact, one-minute check, and human gate before marking the report complete');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'operator already supplied evidence gate');
});

test('executionEvidenceGatePromptBlock names artifact, cheap checks, status boundary, human gate, and safe stop', () => {
  const block = executionEvidenceGatePromptBlock('Audit the scheduled AI job: it is green and successful, but validate report artifacts, logs, output accuracy, and review before external delivery');
  assert.match(block, /EXECUTION EVIDENCE CHECK/);
  assert.match(block, /Expected artifact/);
  assert.match(block, /Cheap checks/);
  assert.match(block, /Status boundary/);
  assert.match(block, /Human gate/);
  assert.match(block, /Safe stop/);
});

test('appendExecutionEvidenceGatePrompt preserves original request first', () => {
  const message = 'Check the cron automation that says completed and verify report output files before downstream automation uses them';
  const augmented = appendExecutionEvidenceGatePrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[EXECUTION EVIDENCE CHECK\]/);
});
