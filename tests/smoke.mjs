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
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
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

before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      VISIONARY_PORT: String(PORT),
      VISIONARY_DB: TEST_DB,
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
});

after(async () => {
  if (serverProc && serverProc.exitCode === null) {
    serverProc.kill('SIGTERM');
    await Promise.race([
      once(serverProc, 'exit'),
      new Promise(r => setTimeout(r, 3000)),
    ]);
    if (serverProc.exitCode === null) serverProc.kill('SIGKILL');
  }
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

test('GET /api/overview returns expected shape', async () => {
  const { status, json } = await http('GET', '/api/overview');
  assert.equal(status, 200);
  assert.ok(json && typeof json === 'object');
  for (const key of ['generated_at', 'counts', 'missions', 'open_tasks',
    'stale_running_runs', 'recent_runs', 'recent_activity', 'latest_by_agent',
    'active_agent_ids']) {
    assert.ok(key in json, `overview missing key: ${key}`);
  }
  assert.ok(Array.isArray(json.missions));
  assert.ok(Array.isArray(json.stale_running_runs));
  assert.ok(Array.isArray(json.active_agent_ids));
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
