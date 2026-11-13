// Unit tests for src/decision-ledger.js — the project decision ledger.
//
// The ledger exists so a project's dated decisions and their rationale are
// durable shared context for humans and agents. These tests pin the rules that
// make it trustworthy: a decision without a rationale is rejected, only
// accepted decisions reach a dispatch prompt, the prompt block is bounded, and
// lifecycle problems (undated, stale, dangling or unreplaced supersessions) are
// surfaced instead of silently treated as current intent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  validateDecisionInput,
  buildDecisionLedger,
  renderDecisionsPromptBlock
} = require('../src/decision-ledger.js');

function row(overrides) {
  return Object.assign({
    id: 1,
    project_id: 1,
    task_id: null,
    title: 'Use SQLite for local state',
    decision: 'Keep all project state in a single SQLite file.',
    rationale: 'Local-first, no network dependency, one file to back up.',
    alternatives_rejected: null,
    constraints: null,
    status: 'accepted',
    decided_by: 'josh',
    decided_at: '2026-11-01',
    supersedes_id: null,
    source: null,
    created_at: '2026-11-01 08:00:00',
    updated_at: '2026-11-01 08:00:00'
  }, overrides || {});
}

test('validation rejects a decision without a rationale or with a bad status', () => {
  const missing = validateDecisionInput({ title: 'T', decision: 'D' });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some(e => e.includes('rationale')));

  const badStatus = validateDecisionInput({
    title: 'T', decision: 'D', rationale: 'R', status: 'maybe'
  });
  assert.equal(badStatus.ok, false);
  assert.ok(badStatus.errors.some(e => e.includes('status')));

  const badDate = validateDecisionInput({
    title: 'T', decision: 'D', rationale: 'R', status: 'accepted', decided_at: '11/01/2026'
  });
  assert.equal(badDate.ok, false);
  assert.ok(badDate.errors.some(e => e.includes('decided_at')));
});

test('validation normalizes a valid record and defaults status to proposed', () => {
  const result = validateDecisionInput({
    title: '  Choose a queue  ',
    decision: '  Use SQLite, not Redis.  ',
    rationale: '  Single user, no ops burden.  ',
    decided_at: '2026-11-12'
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.title, 'Choose a queue');
  assert.equal(result.value.decision, 'Use SQLite, not Redis.');
  assert.equal(result.value.rationale, 'Single user, no ops burden.');
  assert.equal(result.value.status, 'proposed');
  assert.equal(result.value.decided_at, '2026-11-12');
  assert.equal(result.value.supersedes_id, null);
  assert.equal(result.value.task_id, null);
});

test('ledger flags undated, stale, dangling and unreplaced supersessions', () => {
  const ledger = buildDecisionLedger([
    row({ id: 1, decided_at: null }),
    row({ id: 2, decided_at: '2025-01-01' }),
    row({ id: 3, status: 'superseded', decided_at: '2026-10-01' }),
    row({ id: 4, supersedes_id: 999, decided_at: '2026-10-02' }),
    row({ id: 5, status: 'accepted', supersedes_id: 3, decided_at: '2026-10-03' })
  ], { now: '2026-11-13T00:00:00Z' });

  assert.equal(ledger.ok, true);
  assert.equal(ledger.totals.total, 5);
  assert.equal(ledger.totals.accepted, 4);
  assert.equal(ledger.totals.undated, 1);
  assert.equal(ledger.totals.stale, 1);
  assert.equal(ledger.totals.dangling_supersedes, 1);
  assert.equal(ledger.warnings.length, 3);

  const byId = new Map(ledger.decisions.map(d => [d.id, d]));
  assert.ok(byId.get(1).flags.includes('undated'));
  assert.ok(byId.get(2).flags.includes('stale'));
  assert.ok(byId.get(3).flags.includes('superseded_without_replacement'));
  assert.ok(byId.get(4).flags.includes('dangling_supersedes'));
  assert.equal(byId.get(3).superseded_by, 5);
  assert.deepEqual(byId.get(5).flags, []);
});

test('prompt block injects only accepted decisions and reports what it dropped', () => {
  const rows = [
    row({ id: 1, status: 'accepted' }),
    row({ id: 2, status: 'proposed', title: 'Proposed only' }),
    row({ id: 3, status: 'rejected', title: 'Rejected only' }),
    row({ id: 4, status: 'superseded', title: 'Superseded only' }),
    row({ id: 5, status: 'accepted', title: 'Second accepted', decision: 'Second decision.' })
  ];
  const block = renderDecisionsPromptBlock(rows);
  assert.ok(block);
  assert.equal(block.count, 2);
  assert.deepEqual(block.ids.sort(), [1, 5]);
  assert.equal(block.dropped, 0);
  assert.ok(!block.text.includes('Proposed only'));
  assert.ok(!block.text.includes('Rejected only'));
  assert.ok(!block.text.includes('Superseded only'));
  assert.ok(block.text.startsWith('[PROJECT DECISION RECORD'));
});

test('prompt block is bounded by the character cap and drops whole entries', () => {
  const rows = [];
  for (let i = 1; i <= 6; i += 1) {
    rows.push(row({
      id: i,
      title: 'Decision ' + i,
      decision: 'Do the thing for case ' + i + ' with a deliberately long explanation.',
      rationale: 'Because case ' + i + ' needs a rationale long enough to consume budget.'
    }));
  }
  const block = renderDecisionsPromptBlock(rows, { prompt_max_chars: 700 });
  assert.ok(block);
  assert.ok(block.chars <= 700);
  assert.ok(block.count >= 1);
  assert.ok(block.count < 6);
  assert.equal(block.dropped, 6 - block.count);
  assert.equal(block.ids.length, block.count);
});

test('prompt block is null when there are no accepted decisions', () => {
  assert.equal(renderDecisionsPromptBlock([]), null);
  assert.equal(renderDecisionsPromptBlock([row({ status: 'proposed' })]), null);
  assert.equal(renderDecisionsPromptBlock(null), null);
});
