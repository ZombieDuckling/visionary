// Unit tests for src/project-handoff.js — the project resume brief.
//
// The brief exists so a fresh session can resume a project from recorded
// evidence instead of re-reading four panels. These tests pin the properties
// that make it trustworthy: review work comes first, retries carry the failure
// that caused them, missing artifacts and unverified "done" tasks are surfaced,
// standing decisions are disclosed with their staleness, every action cites its
// source, output is deterministic, and unavailable inputs are reported as
// unavailable rather than treated as empty.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildProjectHandoff } = require('../src/project-handoff.js');
const { buildDecisionLedger } = require('../src/decision-ledger.js');

const NOW = '2026-11-17T02:45:00.000Z';

function project(overrides) {
  return Object.assign({
    id: 3,
    name: 'Launch brief',
    slug: 'launch-brief',
    status: 'active',
    description: 'Ship the operator dashboard'
  }, overrides || {});
}

function task(overrides) {
  return Object.assign({
    id: 1,
    title: 'Draft dashboard',
    description: '',
    status: 'todo',
    priority: 'medium',
    agent_id: null,
    created_at: '2026-11-10 04:00:00',
    updated_at: '2026-11-10 04:00:00',
    completed_at: null
  }, overrides || {});
}

function run(overrides) {
  return Object.assign({
    id: 10,
    task_id: 1,
    agent_id: 'coder',
    status: 'completed',
    error: null,
    workdir: '/tmp/visionary/demo/task-1',
    artifacts_json: '[]',
    created_at: '2026-11-16 04:00:00',
    completed_at: '2026-11-16 04:10:00',
    duration_ms: 600000
  }, overrides || {});
}

function artifacts(overrides) {
  return Object.assign({
    ok: true,
    totals: {
      files_recorded: 2,
      files_present: 1,
      files_missing: 1,
      workdirs_missing: 0
    },
    tasks: [
      { task_id: 1, task_title: 'Draft dashboard', files: [
        { path: 'report.md', exists: true, run_id: 10 },
        { path: 'gone.md', exists: false, run_id: 10 }
      ] }
    ],
    missing: [
      { path: 'gone.md', run_id: 10, task_id: 1, agent_id: 'coder', reason: 'missing' }
    ],
    truncated: false,
    warnings: []
  }, overrides || {});
}

function handoff(input) {
  return buildProjectHandoff(Object.assign({
    project: project(),
    tasks: [],
    runs: [],
    ledger: null,
    artifacts: null,
    now: NOW
  }, input || {}));
}

test('empty project asks for the first task and reports unavailable inputs honestly', () => {
  const brief = handoff({ ledger: buildDecisionLedger([]) });
  assert.equal(brief.ok, true);
  assert.equal(brief.snapshot.tasks.total, 0);
  assert.equal(brief.start_here.kind, 'define_work');
  assert.match(brief.markdown, /# Resume brief — Launch brief/);
  assert.match(brief.markdown, /Define the first task/);
  assert.match(brief.markdown, /No tasks recorded/);
  assert.match(brief.markdown, /Artifact index unavailable/);
  assert.doesNotMatch(brief.markdown, /undefined|null/);
});

test('review work ranks first and cites the latest run instead of guessing', () => {
  const brief = handoff({
    tasks: [
      task({ id: 7, title: 'Review pricing copy', status: 'review', updated_at: '2026-11-16 01:00:00' }),
      task({ id: 8, title: 'Build export', status: 'todo', priority: 'critical' })
    ],
    runs: [run({ id: 21, task_id: 7, status: 'completed', artifacts_json: '[{"path":"copy.md"}]' })],
    ledger: buildDecisionLedger([]),
    artifacts: artifacts({ tasks: [{ task_id: 7, files: [{ path: 'copy.md', exists: true, run_id: 21 }] }], missing: [], totals: { files_recorded: 1, files_present: 1, files_missing: 0, workdirs_missing: 0 } })
  });
  assert.equal(brief.next_actions[0].kind, 'review');
  assert.match(brief.next_actions[0].evidence, /run #21 completed/);
  assert.match(brief.next_actions[0].evidence, /1 artifact\(s\) recorded/);
  assert.equal(brief.next_actions[1].kind, 'dispatch');
  assert.match(brief.next_actions[1].evidence, /never dispatched/);
});

test('a failed newest run becomes a retry action carrying its error, and is not hidden by an older success', () => {
  const brief = handoff({
    tasks: [task({ id: 4, status: 'in_progress' })],
    runs: [
      run({ id: 30, task_id: 4, status: 'completed', created_at: '2026-11-14 04:00:00' }),
      run({ id: 31, task_id: 4, status: 'failed', error: 'quota exceeded on claude', created_at: '2026-11-16 04:00:00' })
    ],
    ledger: buildDecisionLedger([]),
    artifacts: artifacts()
  });
  const retry = brief.next_actions.find(function (a) { return a.kind === 'retry'; });
  assert.ok(retry, 'retry action present');
  assert.match(retry.evidence, /run #31/);
  assert.match(retry.evidence, /quota exceeded/);
  assert.ok(brief.blockers.some(function (b) { return b.kind === 'failed_run'; }));
  assert.match(brief.markdown, /run #31 failed for task #4 — quota exceeded/);
  // The older completed run must not mask the newer failure.
  assert.equal(brief.snapshot.runs.latest.id, 31);
});

test('a newest completed run suppresses retry for that task', () => {
  const brief = handoff({
    tasks: [task({ id: 5, status: 'in_progress' })],
    runs: [
      run({ id: 40, task_id: 5, status: 'failed', created_at: '2026-11-15 04:00:00' }),
      run({ id: 41, task_id: 5, status: 'completed', created_at: '2026-11-16 04:00:00' })
    ],
    ledger: buildDecisionLedger([]),
    artifacts: artifacts()
  });
  assert.ok(!brief.next_actions.some(function (a) { return a.kind === 'retry'; }));
});

test('missing artifacts are surfaced before "done" is trusted', () => {
  const brief = handoff({
    tasks: [task({ id: 1, status: 'done', completed_at: '2026-11-16 04:00:00' })],
    runs: [run({ id: 10, task_id: 1, status: 'completed' })],
    ledger: buildDecisionLedger([]),
    artifacts: artifacts()
  });
  const verify = brief.next_actions.find(function (a) { return a.kind === 'verify_artifacts'; });
  assert.ok(verify, 'verify_artifacts action present');
  assert.match(verify.title, /1 recorded artifact/);
  assert.match(verify.evidence, /gone\.md/);
  assert.ok(brief.blockers.some(function (b) { return b.kind === 'missing_artifact'; }));
  assert.doesNotMatch(brief.markdown, /task #1 is done · no artifact recorded/);
});

test('a done task with no recorded artifact asks for outcome confirmation', () => {
  const brief = handoff({
    tasks: [task({ id: 2, status: 'done' })],
    runs: [run({ id: 12, task_id: 2, status: 'completed' })],
    ledger: buildDecisionLedger([]),
    artifacts: artifacts({ tasks: [], missing: [], totals: { files_recorded: 0, files_present: 0, files_missing: 0, workdirs_missing: 0 } })
  });
  const verify = brief.next_actions.find(function (a) { return a.kind === 'verify_outcome'; });
  assert.ok(verify, 'verify_outcome action present');
  assert.match(verify.evidence, /no artifact recorded/);
  assert.equal(brief.snapshot.tasks.done_without_artifacts, 1);
});

test('accepted decisions are disclosed with staleness and undated flags', () => {
  const ledger = buildDecisionLedger([
    {
      id: 1, project_id: 3, title: 'Use SQLite only', decision: 'No second database',
      rationale: 'Local-first and one-file backup', status: 'accepted',
      decided_at: '2026-01-01', decided_by: 'Josh', created_at: '2026-01-01 04:00:00'
    },
    {
      id: 2, project_id: 3, title: 'No build step', decision: 'Vanilla JS frontend',
      rationale: 'No bundler to maintain', status: 'accepted',
      decided_at: null, decided_by: 'Josh', created_at: '2026-11-10 04:00:00'
    }
  ]);
  const brief = handoff({ ledger: ledger });
  const confirm = brief.next_actions.find(function (a) { return a.kind === 'confirm_decision'; });
  assert.ok(confirm, 'confirm_decision action present');
  assert.match(confirm.evidence, /1 stale/);
  assert.match(confirm.evidence, /1 undated/);
  assert.match(brief.markdown, /Use SQLite only/);
  assert.match(brief.markdown, /No build step/);
  assert.match(brief.markdown, /\[undated\]/);
  assert.ok(brief.blockers.some(function (b) { return b.kind === 'undated_decision'; }));
});

test('a stale live run is a claim to check, not a duplicate dispatch', () => {
  const brief = handoff({
    tasks: [task({ id: 6, status: 'in_progress' })],
    runs: [run({ id: 50, task_id: 6, status: 'running', created_at: '2026-11-17 00:00:00' })],
    ledger: buildDecisionLedger([]),
    artifacts: artifacts()
  });
  const stale = brief.next_actions.find(function (a) { return a.kind === 'stale_run'; });
  assert.ok(stale, 'stale_run action present');
  assert.match(stale.evidence, /reports running/);
  assert.ok(brief.blockers.some(function (b) { return b.kind === 'stale_run'; }));
  assert.equal(brief.snapshot.runs.live, 1);
});

test('a fresh live run is counted but does not trigger a stale-run action', () => {
  const brief = handoff({
    tasks: [task({ id: 6, status: 'in_progress' })],
    runs: [run({ id: 51, task_id: 6, status: 'running', created_at: '2026-11-17 02:15:00' })],
    ledger: buildDecisionLedger([]),
    artifacts: artifacts()
  });
  assert.equal(brief.snapshot.runs.live, 1);
  assert.ok(!brief.next_actions.some(function (a) { return a.kind === 'stale_run'; }));
  // in_progress with a live run is not "resume".
  assert.ok(!brief.next_actions.some(function (a) { return a.kind === 'resume'; }));
});

test('the brief is deterministic for a fixed snapshot time', () => {
  const input = {
    project: project(),
    tasks: [
      task({ id: 1, status: 'review' }),
      task({ id: 2, status: 'todo', priority: 'high' })
    ],
    runs: [run({ id: 9, task_id: 1, status: 'failed', error: 'timeout' })],
    ledger: buildDecisionLedger([]),
    artifacts: artifacts(),
    now: NOW
  };
  const first = buildProjectHandoff(input);
  const second = buildProjectHandoff(input);
  assert.equal(first.markdown, second.markdown);
  assert.deepEqual(first.next_actions, second.next_actions);
  assert.equal(first.generated_at, '2026-11-17T02:45:00.000Z');
});

test('lists are bounded with explicit truncation instead of silent omission', () => {
  const many = [];
  for (let i = 1; i <= 12; i += 1) {
    many.push(task({ id: i, title: 'Todo ' + i, status: 'todo', priority: 'low' }));
  }
  const brief = handoff({ tasks: many, ledger: buildDecisionLedger([]), artifacts: artifacts() });
  const dispatches = brief.next_actions.filter(function (a) { return a.kind === 'dispatch'; });
  assert.equal(dispatches.length, 3);
  assert.match(brief.markdown, /\+6 more todo task\(s\)/);
});

test('run history at the cap warns that older runs are not represented', () => {
  const runs = [];
  for (let i = 0; i < 20; i += 1) {
    runs.push(run({ id: 100 + i, task_id: 1, status: 'completed', created_at: '2026-11-1' + (i % 10) + ' 04:00:00' }));
  }
  const brief = handoff({ tasks: [task({ id: 1, status: 'done' })], runs: runs, ledger: buildDecisionLedger([]), artifacts: artifacts() });
  assert.ok(brief.warnings.some(function (w) { return /capped at the newest 20/.test(w); }));
  assert.match(brief.markdown, /Run history is capped/);
});

test('malformed and missing inputs do not throw', () => {
  const brief = buildProjectHandoff({
    project: null,
    tasks: null,
    runs: null,
    ledger: null,
    artifacts: null,
    now: NOW
  });
  assert.equal(brief.ok, true);
  assert.equal(brief.project.name, '');
  assert.equal(brief.start_here.kind, 'define_work');
  assert.doesNotMatch(brief.markdown, /undefined|null/);
});
