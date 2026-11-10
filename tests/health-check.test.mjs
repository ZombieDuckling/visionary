// Unit tests for src/health-check.js — the install-readiness report.
//
// The report is the product's answer to "is this install actually runnable?".
// These tests assert each probe independently: a healthy install passes, and
// every broken part of the program (corrupt state, unwritable artifacts, no
// harness, unreachable agent, missing/mismatched charter, dead watchdog) turns
// into a fail or warn with a fix hint. A probe error must never throw.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildHealthReport, parseHarnessChain, parseTimestamp, CHECK_STATUS } = require('../src/health-check.js');

function healthyDb() {
  return { pragma: (pragma) => (pragma === 'quick_check' ? 'ok' : 'wal') };
}

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'visionary-health-'));
  mkdirSync(join(root, 'artifacts'), { recursive: true });
  mkdirSync(join(root, 'personalities', 'agents'), { recursive: true });
  writeFileSync(join(root, 'personalities', 'agents', 'argus.md'), '---\nagent_id: argus\nname: Argus\n---\nCharter body.\n');
  return root;
}

function healthyInput(root) {
  return {
    db: healthyDb(),
    schemaVersion: 10,
    expectedSchemaVersion: 10,
    artifactRoot: join(root, 'artifacts'),
    repoRoot: root,
    agents: [{ id: 'argus', name: 'Argus', role: 'chief-of-staff', personality_path: 'personalities/agents/argus.md', harness_chain: '["claude","codex"]' }],
    runtimes: [
      { name: 'claude', health: { ok: true, version: '2.0.1 (Claude Code)' } },
      { name: 'codex', health: { ok: true, version: '0.9.0' } }
    ],
    canonicalHarness: (name) => String(name || '').toLowerCase(),
    heartbeatAt: new Date().toISOString(),
    watchdogIntervalSeconds: 60,
    staleRuns: 0,
    schedulesEnabled: 0,
    activeDispatches: 0,
    dbPath: join(root, 'state.sqlite'),
    version: '2.1.14',
    port: 3333,
    startedAt: new Date(Date.now() - 60_000),
    now: new Date()
  };
}

function findCheck(report, id) {
  return (report.checks || []).find((c) => c.id === id);
}

test('healthy install reports ok with no failures', () => {
  const root = makeRoot();
  try {
    const report = buildHealthReport(healthyInput(root));
    assert.equal(report.ok, true);
    assert.equal(report.summary.fail, 0);
    assert.ok(report.summary.pass >= 8, 'expect at least eight passing checks');
    assert.equal(findCheck(report, 'database.integrity').status, CHECK_STATUS.PASS);
    assert.equal(findCheck(report, 'agents.reachability').status, CHECK_STATUS.PASS);
    assert.equal(findCheck(report, 'agents.charters').status, CHECK_STATUS.PASS);
    assert.equal(findCheck(report, 'watchdog.heartbeat').status, CHECK_STATUS.PASS);
    assert.equal(report.environment.schema_version, 10);
    assert.equal(report.environment.org_agents, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('corrupt database fails the integrity check', () => {
  const root = makeRoot();
  try {
    const input = healthyInput(root);
    input.db = { pragma: (pragma) => (pragma === 'quick_check' ? 'database disk image is malformed' : 'wal') };
    const report = buildHealthReport(input);
    assert.equal(report.ok, false);
    const check = findCheck(report, 'database.integrity');
    assert.equal(check.status, CHECK_STATUS.FAIL);
    assert.match(check.detail, /malformed/);
    assert.ok(check.fix, 'failed check carries a fix hint');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a throwing pragma never crashes the report', () => {
  const root = makeRoot();
  try {
    const input = healthyInput(root);
    input.db = { pragma: () => { throw new Error('no such table: schema_version'); } };
    const report = buildHealthReport(input);
    assert.equal(report.ok, false);
    assert.match(findCheck(report, 'database.integrity').detail, /no such table/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('schema version mismatch fails and points at migrations', () => {
  const root = makeRoot();
  try {
    const input = healthyInput(root);
    input.schemaVersion = 9;
    const report = buildHealthReport(input);
    assert.equal(report.ok, false);
    const check = findCheck(report, 'database.schema');
    assert.equal(check.status, CHECK_STATUS.FAIL);
    assert.match(check.fix, /migration/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('missing artifact root fails with a mkdir hint', () => {
  const root = makeRoot();
  try {
    const input = healthyInput(root);
    input.artifactRoot = join(root, 'does-not-exist');
    const report = buildHealthReport(input);
    assert.equal(report.ok, false);
    const check = findCheck(report, 'artifacts.root');
    assert.equal(check.status, CHECK_STATUS.FAIL);
    assert.match(check.fix, /mkdir/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('artifact root probe leaves no residue behind', () => {
  const root = makeRoot();
  try {
    const artifacts = join(root, 'artifacts');
    const report = buildHealthReport(healthyInput(root));
    assert.equal(findCheck(report, 'artifacts.root').status, CHECK_STATUS.PASS);
    assert.deepEqual(readDirSafe(artifacts), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function readDirSafe(dir) {
  // eslint-disable-next-line global-require
  return require('node:fs').readdirSync(dir);
}

test('no harnesses registered fails availability', () => {
  const root = makeRoot();
  try {
    const input = healthyInput(root);
    input.runtimes = [];
    const report = buildHealthReport(input);
    assert.equal(report.ok, false);
    assert.equal(findCheck(report, 'harnesses.available').status, CHECK_STATUS.FAIL);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a single available harness is a warning, not a pass', () => {
  const root = makeRoot();
  try {
    const input = healthyInput(root);
    input.runtimes = [
      { name: 'claude', health: { ok: true, version: '2.0.1' } },
      { name: 'codex', health: { ok: false, error: 'not found' } }
    ];
    const report = buildHealthReport(input);
    assert.equal(report.ok, true, 'degraded install still reports ok');
    const check = findCheck(report, 'harnesses.available');
    assert.equal(check.status, CHECK_STATUS.WARN);
    assert.match(check.detail, /codex/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an agent whose whole chain is missing fails reachability', () => {
  const root = makeRoot();
  try {
    const input = healthyInput(root);
    input.agents = [{ id: 'argus', name: 'Argus', role: 'chief-of-staff', personality_path: 'personalities/agents/argus.md', harness_chain: ['gemini', 'ollama'] }];
    const report = buildHealthReport(input);
    assert.equal(report.ok, false);
    const check = findCheck(report, 'agents.reachability');
    assert.equal(check.status, CHECK_STATUS.FAIL);
    assert.match(check.detail, /Argus \(gemini → ollama\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an agent with no failover is warned', () => {
  const root = makeRoot();
  try {
    const input = healthyInput(root);
    input.agents = [{ id: 'argus', name: 'Argus', role: 'chief-of-staff', personality_path: 'personalities/agents/argus.md', harness_chain: ['claude', 'gemini'] }];
    const report = buildHealthReport(input);
    assert.equal(report.ok, true);
    assert.equal(findCheck(report, 'agents.reachability').status, CHECK_STATUS.WARN);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('legacy flat-registry rows without a role are skipped', () => {
  const root = makeRoot();
  try {
    const input = healthyInput(root);
    input.agents = [
      { id: 'main', name: 'Main', role: null, personality_path: null, harness_chain: null },
      { id: 'argus', name: 'Argus', role: 'chief-of-staff', personality_path: 'personalities/agents/argus.md', harness_chain: ['claude', 'codex'] }
    ];
    const report = buildHealthReport(input);
    assert.equal(report.environment.org_agents, 1);
    assert.equal(findCheck(report, 'agents.reachability').status, CHECK_STATUS.PASS);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('missing charter fails the charter check', () => {
  const root = makeRoot();
  try {
    const input = healthyInput(root);
    input.agents = [{ id: 'argus', name: 'Argus', role: 'chief-of-staff', personality_path: 'personalities/agents/missing.md', harness_chain: ['claude', 'codex'] }];
    const report = buildHealthReport(input);
    assert.equal(report.ok, false);
    assert.match(findCheck(report, 'agents.charters').detail, /missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a charter whose agent_id does not match is a failure', () => {
  const root = makeRoot();
  try {
    const input = healthyInput(root);
    input.agents = [{ id: 'sentinel', name: 'Sentinel', role: 'security', personality_path: 'personalities/agents/argus.md', harness_chain: ['claude', 'codex'] }];
    const report = buildHealthReport(input);
    assert.equal(report.ok, false);
    assert.match(findCheck(report, 'agents.charters').detail, /declares agent_id "argus"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a stale watchdog heartbeat is a warning, not a failure', () => {
  const root = makeRoot();
  try {
    const input = healthyInput(root);
    input.heartbeatAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const report = buildHealthReport(input);
    assert.equal(report.ok, true);
    assert.equal(findCheck(report, 'watchdog.heartbeat').status, CHECK_STATUS.WARN);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing heartbeat warns with a start hint', () => {
  const root = makeRoot();
  try {
    const input = healthyInput(root);
    input.heartbeatAt = null;
    const report = buildHealthReport(input);
    assert.equal(findCheck(report, 'watchdog.heartbeat').status, CHECK_STATUS.WARN);
    assert.match(findCheck(report, 'watchdog.heartbeat').fix, /npm run watchdog/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('stale running rows are surfaced as a warning', () => {
  const root = makeRoot();
  try {
    const input = healthyInput(root);
    input.staleRuns = 3;
    const report = buildHealthReport(input);
    assert.equal(report.ok, true);
    assert.equal(findCheck(report, 'runs.stale').status, CHECK_STATUS.WARN);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('parseHarnessChain accepts JSON arrays and rejects junk', () => {
  assert.deepEqual(parseHarnessChain('["claude","codex"]'), ['claude', 'codex']);
  assert.deepEqual(parseHarnessChain(['hermes']), ['hermes']);
  assert.deepEqual(parseHarnessChain('claude'), []);
  assert.deepEqual(parseHarnessChain(null), []);
  assert.deepEqual(parseHarnessChain(''), []);
});

test('parseTimestamp reads SQLite UTC timestamps as UTC', () => {
  const parsed = parseTimestamp('2026-11-10 02:30:00');
  assert.equal(parsed.toISOString(), '2026-11-10T02:30:00.000Z');
  assert.equal(parseTimestamp('not a date'), null);
  assert.equal(parseTimestamp(null), null);
});
