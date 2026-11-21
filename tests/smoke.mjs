// Smoke tests for Visionary Mission Control core API + Overview cleanup semantics.
// Spawns the server on an isolated DB + port, exercises HTTP endpoints, and
// validates that POST /api/overview/clean-stale-runs is idempotent and never
// touches in-memory dispatches.
//
// Run with: node --test tests/smoke.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const PORT = parseInt(process.env.SMOKE_PORT || '3399', 10);
const BASE = `http://127.0.0.1:${PORT}`;
const tmpRoot = mkdtempSync(join(tmpdir(), 'visionary-smoke-'));
const TEST_DB = join(tmpRoot, 'visionary-smoke.sqlite');
const TEST_ARTIFACT_ROOT = join(tmpRoot, 'artifacts');
mkdirSync(TEST_ARTIFACT_ROOT, { recursive: true });

let serverProc;
let serverStderr = '';

async function http(method, path, body) {
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, json, text };
}

async function waitForReady(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + '/api/tasks');
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`Server never became ready on ${BASE}. Stderr:\n${serverStderr}`);
}

async function startServer() {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      VISIONARY_PORT: String(PORT),
      VISIONARY_DB: TEST_DB,
      VISIONARY_ARTIFACTS: TEST_ARTIFACT_ROOT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', () => { /* swallow */ });
  serverProc.stderr.on('data', (d) => { serverStderr += d.toString(); });
  serverProc.on('exit', (code) => {
    if (code !== null && code !== 0) {
      // eslint-disable-next-line no-console
      console.error('server.js exited with code', code, '\n', serverStderr);
    }
  });
  await waitForReady();
}

async function stopServer() {
  if (!serverProc || serverProc.exitCode !== null) return;
  serverProc.kill('SIGTERM');
  await Promise.race([
    once(serverProc, 'exit'),
    new Promise(r => setTimeout(r, 3000)),
  ]);
  if (serverProc.exitCode === null) serverProc.kill('SIGKILL');
}

before(async () => {
  await startServer();
});

after(async () => {
  await stopServer();
  // Best-effort cleanup of WAL + SHM + the DB file via the temp dir.
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('GET / serves index.html (SPA shell)', async () => {
  const r = await fetch(BASE + '/');
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.ok(body.length > 0, 'index body should be non-empty');
  assert.ok(body.toLowerCase().includes('<!doctype html') || body.toLowerCase().includes('<html'),
    'response should look like HTML');
});

test('GET /api/agents returns the agent allowlist', async () => {
  const { status, json } = await http('GET', '/api/agents');
  assert.equal(status, 200);
  assert.ok(json && Array.isArray(json.agents), 'agents array present');
  assert.ok(json.agents.length >= 8, 'expect at least 8 agents');
  for (const a of json.agents) {
    assert.ok(typeof a.id === 'string' && a.id.length > 0, 'agent id present');
    assert.ok(typeof a.name === 'string' && a.name.length > 0, 'agent name present');
    assert.ok(typeof a.status === 'string', 'agent status present');
  }
  const ids = json.agents.map(a => a.id);
  for (const required of ['main', 'scout', 'analyst', 'forge', 'sentinel']) {
    assert.ok(ids.includes(required), `agent allowlist must include "${required}"`);
  }
});

test('GET /api/agents/:id/charter exposes the instruction set dispatch injects', async () => {
  const { status, json } = await http('GET', '/api/agents/forge/charter');
  assert.equal(status, 200);
  assert.equal(json.agent_id, 'forge');
  assert.equal(json.charter.status, 'ok');
  assert.equal(json.charter.injected_in_dispatch, true);
  assert.equal(json.charter.dispatch_path, 'personalities/agents/forge.md');
  assert.match(json.charter.body, /You are \*\*Forge\*\*/);
  assert.ok(Array.isArray(json.charter.sections) && json.charter.sections.includes('Lane'));
  assert.ok(Array.isArray(json.charter.warnings));
  assert.ok(!json.charter.warnings.some((w) => w.code === 'agent_id_mismatch'));

  const unknown = await http('GET', '/api/agents/ghost/charter');
  assert.equal(unknown.status, 404);
  assert.ok(unknown.json && unknown.json.error);
});

test('GET /api/overview returns expected shape', async () => {
  const { status, json } = await http('GET', '/api/overview');
  assert.equal(status, 200);
  assert.ok(json && typeof json === 'object');
  for (const key of ['generated_at', 'counts', 'missions', 'open_tasks',
    'stale_running_runs', 'recent_runs', 'cost_baseline', 'governance_watchlist', 'recent_activity', 'latest_by_agent',
    'active_agent_ids']) {
    assert.ok(key in json, `overview missing key: ${key}`);
  }
  assert.ok(Array.isArray(json.missions));
  assert.ok(Array.isArray(json.governance_watchlist));
  assert.ok(Array.isArray(json.stale_running_runs));
  assert.ok(Array.isArray(json.active_agent_ids));
  assert.equal(typeof json.cost_baseline.ai_cost_usd, 'number');
  assert.equal(typeof json.cost_baseline.human_baseline_usd, 'number');
  assert.ok(json.cost_baseline.baseline_assumptions, 'baseline assumptions present');
  assert.ok(json.cost_baseline.whole_path_baseline, 'whole-path human baseline present');
  assert.equal(typeof json.cost_baseline.whole_path_baseline.human_search_usd, 'number');
  assert.equal(typeof json.cost_baseline.whole_path_baseline.path_net_delta_usd, 'number');
  assert.ok(json.cost_baseline.hosting_signal, 'hosting signal present');
  assert.equal(typeof json.cost_baseline.hosting_signal.local_first_candidate, 'boolean');
  assert.equal(json.counts.active_dispatches, 0,
    'no in-memory dispatches at smoke-test startup');
});

test('GET /api/tasks returns array on empty DB', async () => {
  const { status, json } = await http('GET', '/api/tasks');
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.tasks));
});

test('POST /api/tasks validates title and creates rows', async () => {
  const bad = await http('POST', '/api/tasks', { description: 'no title' });
  assert.equal(bad.status, 400);
  assert.ok(bad.json && bad.json.error);

  const ok = await http('POST', '/api/tasks', {
    title: 'smoke task', priority: 'high', status: 'todo',
  });
  assert.equal(ok.status, 201);
  assert.ok(ok.json && ok.json.task && ok.json.task.id);
  assert.equal(ok.json.task.title, 'smoke task');
});

test('GET /api/runs returns array', async () => {
  const { status, json } = await http('GET', '/api/runs');
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.runs));
});

test('GET /api/notifications returns array + unread_count', async () => {
  const { status, json } = await http('GET', '/api/notifications');
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.notifications));
  assert.equal(typeof json.unread_count, 'number');
});

test('GET /api/projects returns array', async () => {
  const { status, json } = await http('GET', '/api/projects');
  assert.equal(status, 200);
  assert.ok(json && Array.isArray(json.projects));
});

test('GET /api/projects/:id/artifacts indexes present and missing files', async () => {
  const created = await http('POST', '/api/projects', { name: 'Artifact Smoke Project' });
  assert.equal(created.status, 201);
  const projectId = created.json.project.id;
  const task = await http('POST', '/api/tasks', {
    project_id: projectId,
    title: 'Artifact smoke task',
    status: 'done'
  });
  assert.equal(task.status, 201);
  const taskId = task.json.task.id;

  const workdir = join(TEST_ARTIFACT_ROOT, 'artifact-smoke-project', 'task-' + taskId);
  mkdirSync(join(workdir, 'sub'), { recursive: true });
  writeFileSync(join(workdir, 'report.md'), '# smoke artifact\n');
  writeFileSync(join(workdir, 'sub', 'notes.md'), 'notes\n');

  const Database = require('better-sqlite3');
  const db = new Database(TEST_DB);
  try {
    db.pragma('journal_mode = WAL');
    db.prepare(`
      INSERT INTO agent_runs (task_id, agent_id, message, status, workdir, artifacts_json, created_at)
      VALUES (?, 'forge', 'smoke artifact run', 'completed', ?, ?, datetime('now'))
    `).run(taskId, workdir, JSON.stringify([
      { path: 'report.md', size: 16 },
      { path: 'sub/notes.md', size: 6 },
      { path: 'missing.md', size: 99 }
    ]));
  } finally {
    db.close();
  }

  const { status, json } = await http('GET', '/api/projects/' + projectId + '/artifacts');
  assert.equal(status, 200);
  assert.equal(json.project.id, projectId);
  assert.equal(json.artifacts.totals.files_present, 2);
  assert.equal(json.artifacts.totals.files_missing, 1);
  assert.equal(json.artifacts.totals.runs_with_artifacts, 1);
  assert.equal(json.artifacts.tasks.length, 1);
  const missing = json.artifacts.tasks[0].files.find((f) => f.path === 'missing.md');
  assert.ok(missing, 'missing file is still indexed');
  assert.equal(missing.exists, false);
  assert.equal(missing.reason, 'missing');
  assert.equal(json.artifacts.missing.length, 1);

  const unknown = await http('GET', '/api/projects/999999/artifacts');
  assert.equal(unknown.status, 404);
});

test('POST /api/runs/:id/secret-scan finds credentials, masks them, and stores the scan', async () => {
  const created = await http('POST', '/api/projects', { name: 'Secret Scan Smoke Project' });
  assert.equal(created.status, 201);
  const projectId = created.json.project.id;
  const task = await http('POST', '/api/tasks', {
    project_id: projectId,
    title: 'Secret scan smoke task',
    status: 'done'
  });
  assert.equal(task.status, 201);
  const taskId = task.json.task.id;

  const workdir = join(TEST_ARTIFACT_ROOT, 'secret-scan-smoke-project', 'task-' + taskId);
  mkdirSync(workdir, { recursive: true });
  const fakeKey = 'AKIA' + 'SMOKETESTKEY1234';
  writeFileSync(join(workdir, 'leak.md'), 'aws key ' + fakeKey + '\n');
  writeFileSync(join(workdir, 'clean.md'), '# clean deliverable\n');

  const Database = require('better-sqlite3');
  const db = new Database(TEST_DB);
  let runId;
  try {
    db.pragma('journal_mode = WAL');
    const info = db.prepare(`
      INSERT INTO agent_runs (task_id, agent_id, message, status, workdir, artifacts_json, created_at)
      VALUES (?, 'forge', 'secret scan smoke run', 'completed', ?, ?, datetime('now'))
    `).run(taskId, workdir, JSON.stringify([
      { path: 'leak.md', size: 32 },
      { path: 'clean.md', size: 22 }
    ]));
    runId = Number(info.lastInsertRowid);
  } finally {
    db.close();
  }

  const scanned = await http('POST', '/api/runs/' + runId + '/secret-scan', {});
  assert.equal(scanned.status, 200);
  assert.equal(scanned.json.run_id, runId);
  assert.equal(scanned.json.scan.counts.files, 2);
  const aws = scanned.json.scan.findings.find((f) => f.rule === 'aws_access_key_id');
  assert.ok(aws, 'AWS key detected in the artifact');
  assert.equal(aws.path, 'leak.md');
  assert.ok(!scanned.text.includes(fakeKey), 'the scan response must not echo the credential');

  const stored = await http('GET', '/api/runs/' + runId);
  assert.equal(stored.status, 200);
  assert.ok(stored.json.secret_scan, 'scan is stored on the run');
  assert.equal(stored.json.secret_scan.counts.findings, scanned.json.scan.counts.findings);

  const noWorkdir = await http('POST', '/api/runs/999999/secret-scan', {});
  assert.equal(noWorkdir.status, 404);

  const db2 = new Database(TEST_DB);
  let bareRunId;
  try {
    db2.pragma('journal_mode = WAL');
    const info = db2.prepare(`
      INSERT INTO agent_runs (task_id, agent_id, message, status, created_at)
      VALUES (?, 'forge', 'no workdir run', 'failed', datetime('now'))
    `).run(taskId);
    bareRunId = Number(info.lastInsertRowid);
  } finally {
    db2.close();
  }
  const noDir = await http('POST', '/api/runs/' + bareRunId + '/secret-scan', {});
  assert.equal(noDir.status, 404);
  assert.match(noDir.json.error, /no working directory/i);
});

test('GET /api/projects/:id/usage reports cost per completed outcome with provenance', async () => {
  const created = await http('POST', '/api/projects', { name: 'Usage Smoke Project' });
  assert.equal(created.status, 201);
  const projectId = created.json.project.id;
  const doneTask = await http('POST', '/api/tasks', {
    project_id: projectId,
    title: 'Usage smoke done task',
    status: 'done'
  });
  const openTask = await http('POST', '/api/tasks', {
    project_id: projectId,
    title: 'Usage smoke open task',
    status: 'todo'
  });
  assert.equal(doneTask.status, 201);
  assert.equal(openTask.status, 201);

  const Database = require('better-sqlite3');
  const db = new Database(TEST_DB);
  try {
    db.pragma('journal_mode = WAL');
    const insert = db.prepare(`
      INSERT INTO agent_runs (task_id, agent_id, message, status, input_tokens, output_tokens,
        estimated_cost_usd, usage_source, usage_estimated, created_at)
      VALUES (?, 'forge', 'usage smoke run', ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    // One harness-reported completed run, one estimated failed run. Spend must
    // include the failed attempt and the basis must be disclosed as mixed.
    insert.run(doneTask.json.task.id, 'completed', 1000, 500, 0.4, 'reported', 0);
    insert.run(doneTask.json.task.id, 'failed', 200, 100, 0.1, 'estimated', 1);
    // A legacy row with usage but no recorded provenance.
    db.prepare(`
      INSERT INTO agent_runs (task_id, agent_id, message, status, input_tokens, output_tokens,
        estimated_cost_usd, created_at)
      VALUES (?, 'forge', 'legacy usage run', 'completed', 100, 50, 0.05, datetime('now'))
    `).run(openTask.json.task.id);
  } finally {
    db.close();
  }

  const { status, json } = await http('GET', '/api/projects/' + projectId + '/usage');
  assert.equal(status, 200);
  assert.equal(json.project.id, projectId);
  const usage = json.usage;
  assert.equal(usage.runs.total, 3);
  assert.equal(usage.runs.completed, 2);
  assert.equal(usage.runs.failed, 1);
  assert.equal(usage.runs.with_usage, 3);
  assert.equal(usage.cost.total_usd, 0.55);
  assert.equal(usage.cost.reported_usd, 0.4);
  assert.equal(usage.cost.estimated_usd, 0.1);
  assert.equal(usage.cost.unknown_usd, 0.05);
  assert.equal(usage.tasks.done, 1);
  assert.equal(usage.per_outcome.outcomes, 1);
  assert.equal(usage.per_outcome.cost_usd, 0.55);
  assert.equal(usage.per_outcome.basis, 'mixed');
  assert.equal(usage.usage.total_tokens, 1950);
  assert.ok(usage.warnings.some((w) => w.code === 'unlabeled_basis'));
  assert.match(usage.disclosure, /reported/);

  const unknown = await http('GET', '/api/projects/999999/usage');
  assert.equal(unknown.status, 404);
});

test('GET /api/projects/:id/handoff returns a read-only resume brief from recorded state', async () => {
  const created = await http('POST', '/api/projects', {
    name: 'Handoff Smoke Project',
    description: 'Resume from recorded evidence'
  });
  assert.equal(created.status, 201);
  const projectId = created.json.project.id;
  const reviewTask = await http('POST', '/api/tasks', {
    project_id: projectId,
    title: 'Review pricing copy',
    status: 'review'
  });
  const todoTask = await http('POST', '/api/tasks', {
    project_id: projectId,
    title: 'Build export',
    status: 'todo',
    priority: 'high'
  });
  assert.equal(reviewTask.status, 201);
  assert.equal(todoTask.status, 201);

  const decision = await http('POST', '/api/projects/' + projectId + '/decisions', {
    title: 'Use SQLite only',
    decision: 'No second database',
    rationale: 'Local-first and one-file backup',
    status: 'accepted',
    decided_by: 'smoke',
    decided_at: '2026-01-01'
  });
  assert.equal(decision.status, 201);

  const workdir = join(TEST_ARTIFACT_ROOT, 'handoff-smoke', 'task-' + reviewTask.json.task.id);
  mkdirSync(workdir, { recursive: true });
  writeFileSync(join(workdir, 'report.md'), '# report\n');

  const Database = require('better-sqlite3');
  const db = new Database(TEST_DB);
  try {
    db.prepare(`
      INSERT INTO agent_runs (task_id, agent_id, message, status, error, workdir, artifacts_json, created_at, completed_at)
      VALUES (?, 'coder', 'handoff smoke run', 'failed', 'quota exceeded on claude', ?, ?, datetime('now'), datetime('now'))
    `).run(reviewTask.json.task.id, workdir, JSON.stringify([
      { path: 'report.md' },
      { path: 'gone.md' }
    ]));
  } finally {
    db.close();
  }

  const { status, json } = await http('GET', '/api/projects/' + projectId + '/handoff');
  assert.equal(status, 200);
  assert.equal(json.project.id, projectId);
  const brief = json.handoff;
  assert.equal(brief.ok, true);
  assert.equal(brief.start_here.kind, 'review');
  assert.match(brief.start_here.title, /Review pricing copy/);
  assert.ok(brief.blockers.some((b) => b.kind === 'failed_run'));
  assert.ok(brief.blockers.some((b) => b.kind === 'missing_artifact'));
  assert.match(brief.markdown, /# Resume brief — Handoff Smoke Project/);
  assert.match(brief.markdown, /Use SQLite only/);
  assert.match(brief.markdown, /gone\.md/);
  assert.match(brief.markdown, /Build export/);
  assert.match(brief.markdown, /quota exceeded on claude/);

  // Read-only: a second read returns the same recorded state and actions.
  const again = await http('GET', '/api/projects/' + projectId + '/handoff');
  assert.equal(again.status, 200);
  assert.deepEqual(again.json.handoff.next_actions, brief.next_actions);
  assert.deepEqual(again.json.handoff.blockers, brief.blockers);
  assert.equal(again.json.handoff.snapshot.tasks.total, brief.snapshot.tasks.total);

  const unknown = await http('GET', '/api/projects/999999/handoff');
  assert.equal(unknown.status, 404);
});

test('GET /api/projects/:id/governance returns deterministic readiness analysis', async () => {
  const created = await http('POST', '/api/projects', {
    name: 'Governance Smoke School AI',
    description: 'AI workflow for teachers, students, and support staff with privacy review.'
  });
  assert.equal(created.status, 201);
  const projectId = created.json.project.id;
  const task = await http('POST', '/api/tasks', {
    project_id: projectId,
    title: 'Draft student support recommendation rubric',
    description: 'Include teacher review, fairness, adoption, and policy checks.',
    priority: 'high',
    status: 'todo'
  });
  assert.equal(task.status, 201);

  const { status, json } = await http('GET', '/api/projects/' + projectId + '/governance');
  assert.equal(status, 200);
  assert.equal(json.project.id, projectId);
  assert.equal(json.governance.recommended, true);
  assert.ok(Array.isArray(json.governance.checklist));
  assert.ok(json.governance.triggers.some((t) => t.id === 'affected-users'));
});

test('Project decision ledger: rationale required, supersede is atomic, lifecycle is enforced', async () => {
  const created = await http('POST', '/api/projects', { name: 'Decision Smoke Project' });
  assert.equal(created.status, 201);
  const projectId = created.json.project.id;

  const empty = await http('GET', '/api/projects/' + projectId + '/decisions');
  assert.equal(empty.status, 200);
  assert.equal(empty.json.ledger.totals.total, 0);
  assert.deepEqual(empty.json.ledger.warnings, []);

  // A decision without a rationale is noise, not a record.
  const noWhy = await http('POST', '/api/projects/' + projectId + '/decisions', {
    title: 'No why', decision: 'Do the thing'
  });
  assert.equal(noWhy.status, 400);
  assert.ok(/rationale/.test(noWhy.json.error));

  const first = await http('POST', '/api/projects/' + projectId + '/decisions', {
    title: 'Local-only storage',
    decision: 'Store project state in a single SQLite file.',
    rationale: 'No network dependency and one file to back up.',
    status: 'accepted',
    decided_by: 'smoke'
  });
  assert.equal(first.status, 201);
  assert.equal(first.json.decision.status, 'accepted');
  assert.match(first.json.decision.decided_at, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(first.json.ledger.totals.accepted, 1);

  // Recording a replacement supersedes the target in the same write, so two
  // accepted "truths" cannot coexist.
  const second = await http('POST', '/api/projects/' + projectId + '/decisions', {
    title: 'Local-only storage with WAL',
    decision: 'Store project state in SQLite with WAL enabled.',
    rationale: 'WAL gives concurrent readers without a second process.',
    status: 'accepted',
    supersedes_id: first.json.decision.id
  });
  assert.equal(second.status, 201);
  assert.equal(second.json.ledger.totals.superseded, 1);
  const superseded = second.json.ledger.decisions.find((d) => d.id === first.json.decision.id);
  assert.equal(superseded.status, 'superseded');
  assert.equal(superseded.superseded_by, second.json.decision.id);

  const proposed = await http('POST', '/api/projects/' + projectId + '/decisions', {
    title: 'Redis for queues',
    decision: 'Add Redis for job queues.',
    rationale: 'Faster fan-out if queues grow.'
  });
  assert.equal(proposed.status, 201);
  assert.equal(proposed.json.decision.status, 'proposed');
  assert.equal(proposed.json.decision.decided_at, null);

  const accepted = await http('PATCH', '/api/decisions/' + proposed.json.decision.id, { status: 'accepted' });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.json.decision.status, 'accepted');
  assert.match(accepted.json.decision.decided_at, /^\d{4}-\d{2}-\d{2}$/);

  const badStatus = await http('PATCH', '/api/decisions/' + proposed.json.decision.id, { status: 'maybe' });
  assert.equal(badStatus.status, 400);

  // A supersede link that arrives via PATCH must retire its target too — the
  // invariant is "one accepted record per decision", not "one per POST".
  const viaPatch = await http('PATCH', '/api/decisions/' + proposed.json.decision.id, {
    supersedes_id: second.json.decision.id
  });
  assert.equal(viaPatch.status, 200);
  const ledgerAfterPatch = await http('GET', '/api/projects/' + projectId + '/decisions');
  assert.equal(ledgerAfterPatch.json.ledger.totals.superseded, 2);
  const retired = ledgerAfterPatch.json.ledger.decisions.find((d) => d.id === second.json.decision.id);
  assert.equal(retired.status, 'superseded');
  assert.equal(retired.superseded_by, proposed.json.decision.id);

  const missing = await http('GET', '/api/projects/999999/decisions');
  assert.equal(missing.status, 404);

  const removed = await http('DELETE', '/api/decisions/' + proposed.json.decision.id);
  assert.equal(removed.status, 200);
  const afterDelete = await http('GET', '/api/projects/' + projectId + '/decisions');
  assert.equal(afterDelete.json.ledger.totals.total, 2);
});

test('GET /api/activity returns array', async () => {
  const { status, json } = await http('GET', '/api/activity');
  assert.equal(status, 200);
  assert.ok(json && Array.isArray(json.activity));
});

test('GET /api/unknown returns 404 JSON', async () => {
  const { status, json } = await http('GET', '/api/does-not-exist');
  assert.equal(status, 404);
  assert.ok(json && json.error);
});

test('dispatch records deterministic prompt-context telemetry on the run', async () => {
  const message = 'Fix the login bug in server.js';
  const { status, json } = await http('POST', '/api/dispatch', {
    agent_id: 'argus',
    message,
  });
  assert.ok(status === 201 || status === 202, 'dispatch accepted: got ' + status);
  assert.ok(json && json.run_id, 'dispatch returned a run id');
  // Kill immediately so the smoke run does not wait on a real harness.
  await http('POST', '/api/dispatch/' + json.run_id + '/kill');

  const runs = await http('GET', '/api/runs?task_id=' + json.task_id);
  assert.equal(runs.status, 200);
  const run = (runs.json.runs || []).find((r) => r.id === json.run_id);
  assert.ok(run, 'run row exists');
  const meta = JSON.parse(run.prompt_meta_json || 'null');
  assert.ok(meta, 'prompt_meta_json is recorded');
  assert.equal(meta.original_chars, message.length);
  assert.ok(meta.budget_chars > 0);
  assert.ok(meta.max_nudges > 0);
  assert.ok(Array.isArray(meta.applied));
  assert.ok(Array.isArray(meta.dropped));
  assert.ok(Array.isArray(meta.errors));
  assert.deepEqual(meta.applied.map((a) => a.id), ['failure-study-loop']);
  assert.ok(meta.prompt_chars < 2000, 'short request no longer inflates the prompt');
});

test('dispatch injects accepted project decisions and records what was injected', async () => {
  const created = await http('POST', '/api/projects', { name: 'Decision Injection Project' });
  assert.equal(created.status, 201);
  const projectId = created.json.project.id;
  const decision = await http('POST', '/api/projects/' + projectId + '/decisions', {
    title: 'Local DB only',
    decision: 'Migrations run against the local SQLite file only.',
    rationale: 'The live database is the operator\'s source of truth; never migrate it from a test run.',
    status: 'accepted'
  });
  assert.equal(decision.status, 201);

  // A proposed decision must not be injected: only accepted records are
  // standing constraints for an agent.
  await http('POST', '/api/projects/' + projectId + '/decisions', {
    title: 'Maybe add Redis',
    decision: 'Add Redis for queues.',
    rationale: 'Not needed yet, kept as an option.'
  });

  const task = await http('POST', '/api/tasks', {
    project_id: projectId, title: 'Add decisions index', status: 'todo'
  });
  assert.equal(task.status, 201);
  const dispatch = await http('POST', '/api/dispatch', {
    agent_id: 'argus',
    task_id: task.json.task.id,
    message: 'Add an index to the decisions table'
  });
  assert.ok(dispatch.status === 201 || dispatch.status === 202, 'dispatch accepted: got ' + dispatch.status);
  await http('POST', '/api/dispatch/' + dispatch.json.run_id + '/kill');

  const runs = await http('GET', '/api/runs?task_id=' + task.json.task.id);
  const run = (runs.json.runs || []).find((r) => r.id === dispatch.json.run_id);
  assert.ok(run, 'run row exists');
  const meta = JSON.parse(run.prompt_meta_json || 'null');
  assert.ok(meta && meta.project_decisions, 'project decision telemetry recorded');
  assert.equal(meta.project_decisions.project_id, projectId);
  assert.equal(meta.project_decisions.injected, 1);
  assert.deepEqual(meta.project_decisions.ids, [decision.json.decision.id]);
  assert.ok(meta.project_decisions.chars > 0);
  assert.equal(meta.project_decisions.dropped, 0);
});

test('dispatch injects verified project workspace context and records what was injected', async () => {
  const created = await http('POST', '/api/projects', { name: 'Workspace Context Project' });
  assert.equal(created.status, 201);
  const projectId = created.json.project.id;
  const task = await http('POST', '/api/tasks', {
    project_id: projectId, title: 'Continue the brief', status: 'todo'
  });
  assert.equal(task.status, 201);
  const taskId = task.json.task.id;

  // Seed a prior completed run for this project with a real artifact on disk.
  // The dispatch should see it, verify it, and inject its path; the new task's
  // own run is still pending with no artifacts, so it is not part of the list.
  const priorWorkdir = join(TEST_ARTIFACT_ROOT, 'workspace-context-project', 'task-prior');
  mkdirSync(priorWorkdir, { recursive: true });
  writeFileSync(join(priorWorkdir, 'brief.md'), '# brief\n');

  const Database = require('better-sqlite3');
  const db = new Database(TEST_DB);
  try {
    db.pragma('journal_mode = WAL');
    db.prepare(`
      INSERT INTO agent_runs (task_id, agent_id, message, status, started_at, completed_at, workdir, artifacts_json)
      VALUES (?, 'coder', 'seeded prior run', 'completed', datetime('now', '-2 hours'), datetime('now', '-1 hour'), ?, ?)
    `).run(taskId, priorWorkdir, JSON.stringify([{ path: 'brief.md' }, { path: 'gone.md' }]));
  } finally {
    db.close();
  }

  const dispatch = await http('POST', '/api/dispatch', {
    agent_id: 'argus',
    task_id: taskId,
    message: 'Continue the launch brief from the existing draft'
  });
  assert.ok(dispatch.status === 201 || dispatch.status === 202, 'dispatch accepted: got ' + dispatch.status);
  await http('POST', '/api/dispatch/' + dispatch.json.run_id + '/kill');

  const runs = await http('GET', '/api/runs?task_id=' + taskId);
  const run = (runs.json.runs || []).find((r) => r.id === dispatch.json.run_id);
  assert.ok(run, 'run row exists');
  const meta = JSON.parse(run.prompt_meta_json || 'null');
  assert.ok(meta && meta.project_workspace, 'project workspace telemetry recorded');
  assert.equal(meta.project_workspace.project_id, projectId);
  assert.equal(meta.project_workspace.tasks, 1);
  assert.equal(meta.project_workspace.files, 1);
  assert.equal(meta.project_workspace.missing_files, 1);
  assert.ok(meta.project_workspace.chars > 0);
  assert.equal(meta.project_workspace.workspace_root, join(TEST_ARTIFACT_ROOT, 'workspace-context-project'));
});

test('POST /api/dispatch rejects unknown agent_id (allowlist)', async () => {
  const { status, json } = await http('POST', '/api/dispatch', {
    agent_id: 'totally-fake-agent',
    message: 'whatever',
  });
  assert.equal(status, 400);
  assert.ok(json && /unknown agent/i.test(json.error));
});

test('Overview cleanup: no-op on empty stale set', async () => {
  const { status, json } = await http('POST', '/api/overview/clean-stale-runs');
  assert.equal(status, 200);
  assert.equal(json.cleaned, 0);
  assert.deepEqual(json.runs, []);
});

test('Overview cleanup: idempotent on a single seeded stale row', async () => {
  // Seed a stale running row directly via better-sqlite3 against the same
  // test DB the server is using. This avoids needing a 2h-real-time wait.
  const Database = require('better-sqlite3');
  const db = new Database(TEST_DB);
  try {
    db.pragma('journal_mode = WAL');
    db.prepare(`
      INSERT INTO agent_runs (agent_id, message, status, started_at)
      VALUES ('main', 'smoke-stale', 'running', datetime('now', '-3 hours'))
    `).run();
    const beforeRow = db.prepare(
      "SELECT id, status FROM agent_runs WHERE message = 'smoke-stale'"
    ).get();
    assert.ok(beforeRow, 'seeded row should exist');
    assert.equal(beforeRow.status, 'running');

    // First call should clean exactly 1 row.
    const first = await http('POST', '/api/overview/clean-stale-runs');
    assert.equal(first.status, 200);
    assert.equal(first.json.cleaned, 1, 'first call cleans the seeded row');
    assert.equal(first.json.runs[0].agent_id, 'main');

    // DB row should now be 'timeout'.
    const midRow = db.prepare(
      'SELECT status, completed_at FROM agent_runs WHERE id = ?'
    ).get(beforeRow.id);
    assert.equal(midRow.status, 'timeout');
    assert.ok(midRow.completed_at, 'completed_at should be set');

    // Second call should be a no-op (idempotent).
    const second = await http('POST', '/api/overview/clean-stale-runs');
    assert.equal(second.status, 200);
    assert.equal(second.json.cleaned, 0, 'second call is a no-op');
    assert.deepEqual(second.json.runs, []);

    // Third call for good measure — still 0.
    const third = await http('POST', '/api/overview/clean-stale-runs');
    assert.equal(third.json.cleaned, 0);

    // The timeout row's completed_at should not have been overwritten by
    // the subsequent no-op calls.
    const finalRow = db.prepare(
      'SELECT status, completed_at FROM agent_runs WHERE id = ?'
    ).get(beforeRow.id);
    assert.equal(finalRow.status, 'timeout');
    assert.equal(finalRow.completed_at, midRow.completed_at,
      'idempotent: completed_at not rewritten by repeat cleanup');
  } finally {
    db.close();
  }
});

test('GET /api/export + POST /api/import round-trip', async () => {
  // Seed a project so the export is non-trivial
  const created = await http('POST', '/api/projects', { name: 'Export Test Project', description: 'smoke' });
  assert.equal(created.status, 201);
  const projectId = created.json.project.id;

  // Export
  const exportRes = await fetch(BASE + '/api/export');
  assert.equal(exportRes.status, 200);
  assert.ok(exportRes.headers.get('content-disposition').includes('visionary-backup-'), 'Content-Disposition attachment present');
  const exportJson = await exportRes.json();
  assert.equal(exportJson.schema_version, 1);
  assert.ok(typeof exportJson.exported_at === 'string', 'exported_at present');
  assert.ok(exportJson.tables && typeof exportJson.tables === 'object', 'tables object present');
  for (const tbl of ['projects', 'tasks', 'agent_runs', 'notifications', 'activity_log']) {
    assert.ok(Array.isArray(exportJson.tables[tbl]), `tables.${tbl} is array`);
  }
  const exportedProject = exportJson.tables.projects.find(p => p.id === projectId);
  assert.ok(exportedProject, 'seeded project appears in export');

  // Import (idempotent — same data, should succeed)
  const importRes = await http('POST', '/api/import', exportJson);
  assert.equal(importRes.status, 200);
  assert.ok(importRes.json && importRes.json.imported, 'imported counts present');
  assert.ok(typeof importRes.json.imported.projects === 'number', 'projects count numeric');
  assert.ok(importRes.json.imported.projects >= 1, 'at least one project imported');

  // Import rejects unknown schema_version
  const badVersion = await http('POST', '/api/import', { schema_version: 99, tables: {} });
  assert.equal(badVersion.status, 422);
  assert.ok(badVersion.json && badVersion.json.error, 'error message present for bad schema_version');
});


test('GET /api/runtimes exposes adapter registry and direct mock routing works', async () => {
  const { status, json } = await http('GET', '/api/runtimes');
  assert.equal(status, 200);
  const ids = json.runtimes.map(r => r.id);
  for (const required of ['openclaw', 'claude', 'hermes']) {
    assert.ok(ids.includes(required), `runtime registry includes ${required}`);
  }

  const registry = require('../src/runtimes');
  let called = false;
  registry.registerRuntime('smoke-mock', {
    buildCommand(ctx) {
      called = true;
      assert.equal(ctx.agentId, 'main');
      assert.equal(ctx.message, 'hello');
      return { bin: 'node', args: ['-e', 'process.stdout.write("ok")'] };
    }
  });
  const cmd = registry.getRuntime('smoke-mock').buildCommand({ agentId: 'main', message: 'hello' });
  assert.equal(cmd.bin, 'node');
  assert.equal(called, true, 'mock runtime buildCommand was called for configured agent context');
});

test('GET /api/settings + PUT /api/settings persists operator settings', async () => {
  const before = await http('GET', '/api/settings');
  assert.equal(before.status, 200);
  assert.ok(before.json.settings);
  assert.ok(Array.isArray(before.json.runtimes));

  const payload = {
    port: 3399,
    workspace_path: '/tmp/visionary-workspace',
    theme: 'light',
    default_runtime: 'openclaw'
  };
  const saved = await http('PUT', '/api/settings', payload);
  assert.equal(saved.status, 200);
  assert.equal(saved.json.settings.port, 3399);
  assert.equal(saved.json.settings.workspace_path, '/tmp/visionary-workspace');
  assert.equal(saved.json.settings.theme, 'light');
  assert.equal(saved.json.settings.default_runtime, 'openclaw');
  assert.equal(saved.json.restart_required, true);

  const after = await http('GET', '/api/settings');
  assert.equal(after.status, 200);
  assert.equal(after.json.settings.theme, 'light');
});

test('Rate limiter: GET /api/agents/:id/throttle returns bucket state', async () => {
  // Use a known agent seeded by org-chart bootstrap (main/jarvis is always present).
  const { status, json } = await http('GET', '/api/agents/main/throttle');
  assert.equal(status, 200);
  assert.ok(json && json.agent_id === 'main', 'agent_id present');
  assert.ok(json.throttle, 'throttle object present');
  assert.equal(typeof json.throttle.tokens, 'number', 'tokens is a number');
  assert.equal(typeof json.throttle.capacity, 'number', 'capacity is a number');
  assert.equal(typeof json.throttle.refill_per_second, 'number', 'refill_per_second is a number');
  assert.ok(json.throttle.tokens >= 0, 'tokens non-negative');
  assert.ok(json.throttle.capacity >= 1, 'capacity at least 1');
});

test('Rate limiter: PUT /api/agents/:id/throttle reconfigures bucket', async () => {
  const { status, json } = await http('PUT', '/api/agents/main/throttle', {
    capacity: 5,
    refill_per_second: 0.5
  });
  assert.equal(status, 200);
  assert.equal(json.throttle.capacity, 5);
  assert.equal(json.throttle.refill_per_second, 0.5);
  assert.equal(json.throttle.tokens, 5, 'bucket resets to full on reconfigure');

  // Persisted — round-trip via GET
  const get = await http('GET', '/api/agents/main/throttle');
  assert.equal(get.json.throttle.capacity, 5);
});

test('Rate limiter: acquire + token-bucket unit smoke (via require)', () => {
  const rl = require('../src/rate-limiter');

  // Give scout a small bucket so we can exhaust it quickly.
  rl.configure('scout', 3, 10);
  assert.ok(rl.acquire('scout'), 'first acquire allowed');
  assert.ok(rl.acquire('scout'), 'second acquire allowed');
  assert.ok(rl.acquire('scout'), 'third acquire allowed');
  assert.equal(rl.acquire('scout'), false, 'fourth acquire denied — bucket empty');

  // After refill the bucket should recover.
  rl.configure('scout', 3, 10);
  assert.ok(rl.acquire('scout'), 'allowed again after re-configure (reset)');
});

test('Token-aware replay: selectForReplay covers small + large conversation', () => {
  const guardrails = require('../src/guardrails');

  // Small conversation — all messages fit within ceiling.
  const small = [
    { id: 1, role: 'user',      content: 'hello' },
    { id: 2, role: 'assistant', content: 'world' }
  ];
  // newest-first (as getRecentAgentMessages returns them)
  const smallReversed = small.slice().reverse();
  const selectedSmall = guardrails.selectForReplay(smallReversed, 8000, true);
  assert.equal(selectedSmall.length, 2, 'small: both messages included');
  assert.equal(selectedSmall[0].id, 1, 'small: returned in chronological order');

  // Large conversation — content that exceeds ceiling
  const bigContent = 'x'.repeat(4001); // ~1000 tokens each
  const large = [
    { id: 10, role: 'user',      content: bigContent },
    { id: 11, role: 'assistant', content: bigContent },
    { id: 12, role: 'user',      content: bigContent },
    { id: 13, role: 'assistant', content: bigContent },
    { id: 14, role: 'user',      content: 'final question' }
  ];
  const largeReversed = large.slice().reverse(); // newest-first
  const ceiling = 2000; // fits ~2 turns
  const selectedLarge = guardrails.selectForReplay(largeReversed, ceiling, true);
  assert.ok(selectedLarge.length < large.length, 'large: older turns pruned to fit ceiling');
  assert.ok(selectedLarge.length >= 1, 'large: at least the most-recent turn included');
  // Must be chronological
  for (let i = 1; i < selectedLarge.length; i++) {
    assert.ok(selectedLarge[i].id > selectedLarge[i - 1].id, 'large: chronological order');
  }
});

test('Token-aware replay: failover.js source uses selectForReplay (structural)', () => {
  const src = readFileSync(join(repoRoot, 'src', 'runtimes', 'failover.js'), 'utf8');
  assert.ok(src.includes('selectForReplay'), 'failover uses guardrails.selectForReplay');
  assert.ok(src.includes('estimatedTokens'), 'failover reports estimated token count');
  assert.ok(/est\. tokens/.test(src), 'replay header includes "est. tokens"');
  assert.ok(src.includes('rate-limiter'), 'failover imports rate-limiter');
  assert.ok(src.includes("status: 'rate-limited'"), 'failover returns rate-limited status');
});

test('GET /api/health returns a readiness report with every required probe', async () => {
  const { status, json } = await http('GET', '/api/health');
  assert.equal(status, 200);
  assert.ok(json && typeof json === 'object', 'health report is JSON');
  assert.equal(typeof json.ok, 'boolean', 'ok is boolean');
  assert.ok(json.summary && typeof json.summary.pass === 'number'
    && typeof json.summary.warn === 'number' && typeof json.summary.fail === 'number', 'summary counts present');
  assert.ok(Array.isArray(json.checks) && json.checks.length >= 8, 'checks array present');
  const ids = json.checks.map((c) => c.id);
  for (const required of ['database.integrity', 'database.schema', 'artifacts.root',
    'harnesses.available', 'agents.reachability', 'agents.charters', 'watchdog.heartbeat', 'runs.stale']) {
    assert.ok(ids.includes(required), `health report missing check: ${required}`);
  }
  for (const check of json.checks) {
    assert.ok(['pass', 'warn', 'fail'].includes(check.status), `invalid status on ${check.id}`);
    assert.ok(typeof check.detail === 'string' && check.detail.length > 0, `empty detail on ${check.id}`);
    if (check.status === 'fail') assert.ok(check.fix, `failed check ${check.id} needs a fix hint`);
  }
  assert.ok(json.environment && typeof json.environment.schema_version === 'number', 'schema version reported');
  assert.equal(json.ok, json.summary.fail === 0, 'ok must agree with the fail count');
});

test('POST /api/watchdog/heartbeat makes the watchdog check fresh', async () => {
  const post = await http('POST', '/api/watchdog/heartbeat', { pid: 4242 });
  assert.equal(post.status, 200);
  assert.equal(post.json.ok, true);
  assert.ok(post.json.heartbeat && typeof post.json.heartbeat.at === 'string', 'heartbeat timestamp returned');
  const { status, json } = await http('GET', '/api/health');
  assert.equal(status, 200);
  const check = json.checks.find((c) => c.id === 'watchdog.heartbeat');
  assert.equal(check.status, 'pass', 'fresh heartbeat should pass');
  assert.match(check.detail, /heartbeat \d+s ago/);
});

test('GET /api/health never reports a passing database integrity check falsely', async () => {
  const { json } = await http('GET', '/api/health');
  const check = json.checks.find((c) => c.id === 'database.integrity');
  assert.equal(check.status, 'pass');
  assert.match(check.detail, /quick_check returned ok/);
  const schema = json.checks.find((c) => c.id === 'database.schema');
  assert.equal(schema.status, 'pass', 'fresh isolated DB should match the shipped schema');
});
test('Overview cleanup: source code does not touch activeDispatches map (live-dispatch safety)', () => {
  // Static structural assertion: the cleanup handler must not mutate the
  // in-memory dispatch map. We grep the handler block of server.js.
  const src = readFileSync(join(repoRoot, 'server.js'), 'utf8');
  const start = src.indexOf('/api/overview/clean-stale-runs');
  assert.ok(start !== -1, 'cleanup route should exist');
  const handler = src.slice(start, start + 4000);
  // Reads from the map are fine (we explicitly skip live rows), but no writes:
  assert.ok(!/activeDispatches\.delete\b/.test(handler),
    'cleanup must not delete activeDispatches entries');
  assert.ok(!/activeDispatches\.set\b/.test(handler),
    'cleanup must not insert activeDispatches entries');
  assert.ok(!/activeDispatches\.clear\b/.test(handler),
    'cleanup must not clear activeDispatches');
  assert.ok(!/\.process\.kill\b/.test(handler),
    'cleanup must not kill any child process');
  assert.ok(/activeDispatches\.has\(/.test(handler),
    'cleanup should guard live rows via activeDispatches.has()');
});

test('Project decision UI: detail view fetches, renders, records, and supersedes', () => {
  // Structural assertion that the client wires the decision ledger into the
  // project detail view, and that mutations go through the decision endpoints
  // rather than editing the DOM optimistically.
  const app = readFileSync(join(repoRoot, 'public', 'app.js'), 'utf8');
  assert.ok(app.includes("'/projects/' + selectedProject + '/decisions'"),
    'project detail must fetch the decision ledger');
  assert.ok(app.includes('renderProjectDecisions(bundle.decisions, p.id)'),
    'project detail must render the ledger');
  assert.ok(app.includes('data-action="new-decision"'),
    'ledger must expose a record-decision action');
  assert.ok(app.includes("'/projects/' + projectId + '/decisions', { method: 'POST'"),
    'the decision form must POST to the project ledger');
  assert.ok(app.includes("'/decisions/' + decisionStatus.getAttribute('data-did')"),
    'accept/reject must PATCH the decision record');
  assert.ok(app.includes("data-action=\"supersede-decision\""),
    'accepted decisions must be supersedable');
  assert.ok(app.includes("body.supersedes_id = Number(supersedeId)"),
    'supersede must carry the supersedes_id link');
});

test('Project artifact UI: detail view fetches, renders, and opens indexed artifacts', () => {
  // Structural assertion that the client wires the project artifact index into
  // the project detail view and routes clicks through the run-open endpoint.
  const app = readFileSync(join(repoRoot, 'public', 'app.js'), 'utf8');
  assert.ok(app.includes("'/projects/' + selectedProject + '/artifacts'"),
    'project detail must fetch the artifact index');
  assert.ok(app.includes('renderProjectArtifacts(bundle.artifacts)'),
    'project detail must render the artifact index');
  assert.ok(app.includes('data-action="open-artifact"'),
    'artifact rows must be clickable');
  assert.ok(app.includes("'/runs/' + artifactFile.getAttribute('data-run-id') + '/open'"),
    'artifact clicks must use the run-open endpoint');
  assert.ok(app.includes("Artifact missing on disk"),
    'missing artifacts must not be opened');
});

test('Run secret scan UI: findings render on the run and unscanned runs offer a re-scan', () => {
  // Structural assertion that the stored scan is surfaced on the run card, and
  // that an unscanned run is offered a re-scan rather than silently rendered
  // as clean.
  const app = readFileSync(join(repoRoot, 'public', 'app.js'), 'utf8');
  assert.ok(app.includes('r.secret_scan_json'),
    'run cards must read the stored scan');
  assert.ok(app.includes('run-secret-warning'),
    'findings must render as a visible warning');
  assert.ok(app.includes('run-secret-clean'),
    'a clean scan must be stated explicitly');
  assert.ok(app.includes("'/runs/' + btn.getAttribute('data-run-id') + '/secret-scan'"),
    'unscanned runs must use the on-demand scan endpoint');
  assert.ok(app.includes('run-scan-btn'),
    'unscanned runs must offer a scan button');
});

test('Project cost UI: detail view fetches usage and discloses estimate basis', () => {
  // Structural assertion that cost per completed outcome is wired into the
  // project detail view and that estimates are labeled rather than rendered as
  // observed spend.
  const app = readFileSync(join(repoRoot, 'public', 'app.js'), 'utf8');
  assert.ok(app.includes("'/projects/' + selectedProject + '/usage'"),
    'project detail must fetch the usage summary');
  assert.ok(app.includes('renderProjectUsage(bundle.usage)'),
    'project detail must render the usage summary');
  assert.ok(app.includes('Cost per completed outcome'),
    'usage panel must lead with cost per completed outcome');
  assert.ok(app.includes('unavailable — no completed task'),
    'cost per outcome must be withheld when nothing is done');
  assert.ok(app.includes("Number(r.usage_estimated) === 1 ? ' est.'"),
    'estimated run costs must be marked est.');
});

test('Project resume brief UI: detail view fetches, renders, and copies the brief', () => {
  // Structural assertion that the resume brief is wired into the project detail
  // view, that the preview is escaped text, and that copying goes through the
  // clipboard helper with a fallback rather than a raw navigator call.
  const app = readFileSync(join(repoRoot, 'public', 'app.js'), 'utf8');
  assert.ok(app.includes("'/projects/' + selectedProject + '/handoff'"),
    'project detail must fetch the resume brief');
  assert.ok(app.includes('renderProjectHandoff(bundle.handoff)'),
    'project detail must render the resume brief');
  assert.ok(app.includes('data-action="copy-handoff"'),
    'resume brief must have a copy control');
  assert.ok(app.includes("esc(brief.markdown || '')"),
    'brief preview must be escaped, not injected as HTML');
  assert.ok(app.includes('function copyText('),
    'copying must go through the clipboard helper');
  assert.ok(app.includes('copyTextFallback'),
    'clipboard must have a non-secure-context fallback');
});

test('Boot reconciliation marks runs orphaned by a restart as timeout', async () => {
  // Seed rows that claim to be live while the running server owns no dispatch
  // for them — exactly the state a crash, SIGKILL, or `vision restart` leaves.
  const Database = require('better-sqlite3');
  const db = new Database(TEST_DB);
  let pendingId;
  let runningId;
  try {
    db.pragma('journal_mode = WAL');
    db.prepare(`
      INSERT INTO agent_runs (agent_id, message, status, started_at)
      VALUES ('argus', 'smoke-orphan-pending', 'pending', datetime('now', '-5 minutes'))
    `).run();
    db.prepare(`
      INSERT INTO agent_runs (agent_id, message, status, started_at)
      VALUES ('forge', 'smoke-orphan-running', 'running', datetime('now', '-3 hours'))
    `).run();
    pendingId = db.prepare("SELECT id FROM agent_runs WHERE message = 'smoke-orphan-pending'").get().id;
    runningId = db.prepare("SELECT id FROM agent_runs WHERE message = 'smoke-orphan-running'").get().id;
  } finally {
    db.close();
  }

  // A clean SIGTERM stop, then a fresh boot: the seeded rows were never in the
  // old process's activeDispatches, so only boot reconciliation can reach them.
  await stopServer();
  await startServer();

  const db2 = new Database(TEST_DB);
  try {
    const rows = db2.prepare(
      'SELECT id, status, error, completed_at, duration_ms FROM agent_runs WHERE id IN (?, ?)'
    ).all(pendingId, runningId);
    assert.equal(rows.length, 2, 'both seeded rows still exist');
    for (const row of rows) {
      assert.equal(row.status, 'timeout', 'orphaned run is reconciled to timeout');
      assert.ok(row.completed_at, 'completed_at is recorded');
      assert.match(row.error, /^Interrupted: Visionary started at /,
        'error says the restart interrupted the run');
      assert.ok(row.error.includes('workdir'), 'error points at surviving files');
    }
    const runningRow = rows.find((r) => r.id === runningId);
    assert.ok(runningRow.duration_ms >= 2 * 60 * 60 * 1000,
      'duration_ms is derived from started_at, not guessed');

    const reconciled = db2.prepare(
      "SELECT agent_id, task_id, detail_json FROM activity_log WHERE event_type = 'run.reconciled'"
    ).all();
    const reconciledIds = reconciled
      .map((a) => { try { return JSON.parse(a.detail_json).run_id; } catch { return null; } })
      .filter((id) => id !== null);
    assert.ok(reconciledIds.includes(pendingId) && reconciledIds.includes(runningId),
      'boot reconciliation writes an activity row per reconciled run');
  } finally {
    db2.close();
  }

  const notifications = await http('GET', '/api/notifications');
  const warning = (notifications.json.notifications || []).find(
    (n) => /interrupted run\(s\) reconciled at startup/.test(n.title)
  );
  assert.ok(warning, 'a startup warning notification reports the reconciled runs');
  assert.ok(warning.body.includes('task status was left unchanged'),
    'the notification states that task status was not guessed at');

  const health = await http('GET', '/api/health');
  const staleCheck = (health.json.checks || []).find((c) => c.id === 'runs.stale');
  assert.ok(staleCheck, 'health report includes the run-hygiene check');
  assert.equal(staleCheck.status, 'pass', 'no stale running rows remain after boot reconciliation');
});
