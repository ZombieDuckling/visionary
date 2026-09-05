import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyDownstreamExport,
  downstreamExportPromptBlock,
  appendDownstreamExportPrompt
} = require('../src/downstream-export.js');

test('classifyDownstreamExport ignores ordinary task dispatches', () => {
  const result = classifyDownstreamExport('Ask Scout for a quick local market signal summary');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'not downstream-export shaped');
  assert.equal(downstreamExportPromptBlock('Ask Scout for a quick local market signal summary'), '');
});

test('classifyDownstreamExport detects format export packages', () => {
  const result = classifyDownstreamExport('Export the deck into Canva and PowerPoint files with a source markdown brief');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'format-export-package');
  assert.ok(result.signals.source >= 2);
  assert.ok(result.signals.export >= 1);
  assert.ok(result.signals.target >= 2);
});

test('classifyDownstreamExport detects implementation-ready exports', () => {
  const result = classifyDownstreamExport('Package the HTML spec and repo notes so Claude Code can implement the website');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'implementation-ready-export');
});

test('classifyDownstreamExport detects human handoff packages', () => {
  const result = classifyDownstreamExport('Bundle the proposal docs and send a ZIP handoff package to the vendor and client');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'human-handoff-package');
});

test('downstreamExportPromptBlock names source, target, package, context, checks, and review path', () => {
  const block = downstreamExportPromptBlock('Convert the source deck into Canva and a vendor handoff brief');
  assert.match(block, /DOWNSTREAM-EXPORT CHECK/);
  assert.match(block, /Canonical source/);
  assert.match(block, /Target consumer\/tool/);
  assert.match(block, /Output package/);
  assert.match(block, /Continuation context/);
  assert.match(block, /Fidelity checks/);
  assert.match(block, /Review path/);
});

test('appendDownstreamExportPrompt preserves original request first', () => {
  const message = 'Export this source deck to PowerPoint and include contractor handoff notes';
  const augmented = appendDownstreamExportPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[DOWNSTREAM-EXPORT CHECK\]/);
});
