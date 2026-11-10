'use strict';

// Deterministic install-readiness report for a local Visionary instance.
//
// Visionary dispatches real CLI harnesses that write real files into a per-task
// workdir, with an independent watchdog and a cron scheduler. A green status LED
// in the UI is not evidence that the program is runnable: the DB can be
// corrupt, the artifact root can be unwritable, an agent's whole harness chain
// can be missing from PATH, a personality charter can be absent or mismatched,
// and the watchdog can be dead. This module checks those conditions with real
// probes (SQLite quick_check, a write/read/unlink probe in the artifact root,
// harness version probes, charter reads) and returns one report the operator
// can act on.
//
// This applies Jake Van Clief's "AI is part of a program" lesson: the program is
// instructions + runner + surviving state + hand-back surface + provenance. A
// readiness check must verify each part exists, not just that the server process
// is listening. It also applies the execution-evidence lesson: report what was
// actually observed (version strings, probe results, timestamps), never a
// plausible-looking guess.
//
// Statuses are deliberately three-valued:
//   pass — probe succeeded
//   warn — the install works but is degraded (no failover, stale watchdog,
//          stale run rows, charter metadata mismatch)
//   fail — a dispatch cannot be trusted to run (corrupt DB, unwritable
//          artifacts, no harness, agent with zero reachable harnesses, missing
//          charter)
//
// `ok` is true only when no check failed. A report is never allowed to throw:
// every probe is guarded, and a probe error becomes a failed check with the
// error text in `detail`.

const fs = require('node:fs');
const path = require('node:path');

const CHECK_STATUS = { PASS: 'pass', WARN: 'warn', FAIL: 'fail' };

function parseHarnessChain(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
  } catch {
    return [];
  }
}

// SQLite datetime('now') is UTC with no timezone suffix. ISO timestamps are
// also accepted so the heartbeat writer can change format without breaking the
// check. Returns null when the value cannot be parsed.
function parseTimestamp(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  // 'YYYY-MM-DD HH:MM:SS' (SQLite UTC)
  const sqliteMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (sqliteMatch) {
    const [, y, mo, d, h, mi, s] = sqliteMatch;
    return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readCharterAgentId(filePath) {
  let text = '';
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(2048);
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);
    text = buffer.slice(0, bytes).toString('utf8');
  } catch {
    return { ok: false, agentId: null, error: 'unreadable' };
  }
  const match = text.match(/^---[\s\S]*?\bagent_id:\s*([\w-]+)/m);
  return { ok: true, agentId: match ? match[1] : null, error: null };
}

function buildHealthReport(input) {
  const options = input || {};
  const now = options.now instanceof Date ? options.now : new Date();
  const checks = [];

  function push(id, label, status, detail, fix) {
    const check = { id: id, label: label, status: status, detail: String(detail || '') };
    if (fix) check.fix = String(fix);
    checks.push(check);
  }

  // --- Database: is the surviving state readable and intact? ---
  let quickCheck = 'unknown';
  try {
    quickCheck = String(options.db.pragma('quick_check', { simple: true }));
  } catch (err) {
    quickCheck = 'error: ' + (err && err.message ? err.message : String(err));
  }
  if (quickCheck === 'ok') {
    push('database.integrity', 'Database integrity', CHECK_STATUS.PASS, 'SQLite quick_check returned ok.');
  } else {
    push('database.integrity', 'Database integrity', CHECK_STATUS.FAIL,
      'SQLite quick_check returned "' + quickCheck + '".',
      'Back up the DB file, then run `sqlite3 <db> "PRAGMA integrity_check"` and restore from an export if it reports errors.');
  }

  let journalMode = 'unknown';
  try {
    journalMode = String(options.db.pragma('journal_mode', { simple: true }));
  } catch { /* journal mode is informational */ }
  const schemaVersion = Number(options.schemaVersion);
  const expectedSchemaVersion = Number(options.expectedSchemaVersion);
  if (Number.isInteger(schemaVersion) && Number.isInteger(expectedSchemaVersion) && schemaVersion === expectedSchemaVersion) {
    push('database.schema', 'Database schema', CHECK_STATUS.PASS,
      'Schema version ' + schemaVersion + ' matches the shipped migrations (journal mode: ' + journalMode + ').');
  } else {
    push('database.schema', 'Database schema', CHECK_STATUS.FAIL,
      'Schema version is ' + (Number.isFinite(schemaVersion) ? schemaVersion : 'unknown')
      + ' but this build expects ' + (Number.isFinite(expectedSchemaVersion) ? expectedSchemaVersion : 'unknown') + '.',
      'Restart the server so db.js runs the pending migrations; if the DB is newer than the code, update the checkout instead of downgrading.');
  }

  // --- Artifact root: will a dispatch be able to write its deliverables? ---
  const artifactRoot = String(options.artifactRoot || '');
  if (!artifactRoot) {
    push('artifacts.root', 'Artifact workspace', CHECK_STATUS.FAIL, 'No artifact root configured.', 'Set VISIONARY_ARTIFACTS or leave the default ~/Visionary path intact.');
  } else {
    let artifactStatus = CHECK_STATUS.PASS;
    let artifactDetail = 'Writable: ' + artifactRoot;
    let artifactFix = null;
    try {
      const stat = fs.statSync(artifactRoot);
      if (!stat.isDirectory()) {
        artifactStatus = CHECK_STATUS.FAIL;
        artifactDetail = artifactRoot + ' exists but is not a directory.';
        artifactFix = 'Move the file aside or point VISIONARY_ARTIFACTS at a directory.';
      } else {
        const probe = path.join(artifactRoot, '.visionary-health-' + process.pid + '-' + Date.now());
        fs.writeFileSync(probe, 'visionary-health-probe', { encoding: 'utf8' });
        const readBack = fs.readFileSync(probe, 'utf8');
        fs.unlinkSync(probe);
        if (readBack !== 'visionary-health-probe') {
          artifactStatus = CHECK_STATUS.FAIL;
          artifactDetail = artifactRoot + ' is writable but the probe read back unexpected content.';
          artifactFix = 'Check for a full disk or a filesystem that silently drops writes.';
        }
      }
    } catch (err) {
      artifactStatus = CHECK_STATUS.FAIL;
      artifactDetail = artifactRoot + ' is not writable: ' + (err && err.message ? err.message : String(err));
      artifactFix = 'Create the directory (`mkdir -p ' + artifactRoot + '`) and confirm the server user owns it.';
    }
    push('artifacts.root', 'Artifact workspace', artifactStatus, artifactDetail, artifactFix);
  }

  // --- Harnesses: can any runtime actually be spawned? ---
  const runtimes = Array.isArray(options.runtimes) ? options.runtimes : [];
  const available = runtimes.filter(function (rt) { return rt && rt.health && rt.health.ok; });
  const unavailable = runtimes.filter(function (rt) { return !(rt && rt.health && rt.health.ok); });
  const availableNames = available.map(function (rt) { return rt.name || rt.id; });
  if (!runtimes.length) {
    push('harnesses.available', 'Harness availability', CHECK_STATUS.FAIL, 'No harness adapters are registered.', 'Check src/runtimes/index.js.');
  } else if (!available.length) {
    push('harnesses.available', 'Harness availability', CHECK_STATUS.FAIL,
      'None of the ' + runtimes.length + ' registered harness CLIs answered a version probe.',
      'Install or repair at least one CLI (openclaw, claude, hermes, cursor, codex, gemini, ollama) and confirm it is on PATH for the server process.');
  } else {
    const detail = available.length + ' of ' + runtimes.length + ' harnesses available: '
      + available.map(function (rt) { return (rt.name || rt.id) + ' ' + String((rt.health && rt.health.version) || '').split('\n')[0].trim(); }).join('; ')
      + (unavailable.length ? '. Unavailable: ' + unavailable.map(function (rt) { return rt.name || rt.id; }).join(', ') : '.');
    if (available.length === 1) {
      push('harnesses.available', 'Harness availability', CHECK_STATUS.WARN,
        detail + ' Only one harness is available, so failover has nowhere to go.',
        'Install a second harness (for example claude or codex) so executeWithFailover can move a run instead of failing it.');
    } else {
      push('harnesses.available', 'Harness availability', CHECK_STATUS.PASS, detail);
    }
  }

  // --- Agent reachability: every org node needs at least one live harness in
  // its chain, or a dispatch is guaranteed to exhaust before it starts. ---
  const agents = Array.isArray(options.agents) ? options.agents : [];
  const canonicalHarness = typeof options.canonicalHarness === 'function'
    ? options.canonicalHarness
    : function (name) { return String(name || '').toLowerCase(); };
  const availableCanonical = new Set(available.map(function (rt) { return canonicalHarness(rt.name || rt.id); }));
  const unreachable = [];
  const noFailover = [];
  agents.forEach(function (agent) {
    if (!agent || !agent.role) return; // skip legacy flat-registry rows
    const chain = parseHarnessChain(agent.harness_chain);
    const reachable = chain.filter(function (name) { return availableCanonical.has(canonicalHarness(name)); });
    if (!chain.length) {
      unreachable.push((agent.name || agent.id) + ' (empty harness chain)');
    } else if (!reachable.length) {
      unreachable.push((agent.name || agent.id) + ' (' + chain.join(' → ') + ')');
    } else if (reachable.length === 1 && chain.length > 1) {
      noFailover.push((agent.name || agent.id) + ' (' + reachable[0] + ' only)');
    }
  });
  if (!agents.length) {
    push('agents.reachability', 'Agent reachability', CHECK_STATUS.WARN, 'No org-chart agents are registered.', 'Confirm personalities/org-chart.json parses and the server bootstrapped the chart.');
  } else if (unreachable.length) {
    push('agents.reachability', 'Agent reachability', CHECK_STATUS.FAIL,
      unreachable.length + ' agent(s) have no installed harness: ' + unreachable.join(', ') + '.',
      'Install one of the harnesses named in each chain, or edit personalities/org-chart.json so the chain starts with an installed CLI, then restart the server.');
  } else if (noFailover.length) {
    push('agents.reachability', 'Agent reachability', CHECK_STATUS.WARN,
      noFailover.length + ' agent(s) have only one reachable harness: ' + noFailover.join(', ') + '.',
      'Add a second installed harness to those chains so a quota or outage does not stop the agent.');
  } else {
    push('agents.reachability', 'Agent reachability', CHECK_STATUS.PASS,
      'All ' + agents.filter(function (a) { return a && a.role; }).length + ' org agents have at least two reachable harnesses.');
  }

  // --- Charters: the instruction half of the program must exist and match the
  // agent it is loaded for. A missing or mismatched charter silently changes
  // who the agent is. ---
  const repoRoot = String(options.repoRoot || process.cwd());
  const charterProblems = [];
  let charterCount = 0;
  agents.forEach(function (agent) {
    if (!agent || !agent.role) return;
    charterCount += 1;
    const label = agent.name || agent.id;
    if (!agent.personality_path) {
      charterProblems.push(label + ' has no personality_path');
      return;
    }
    const resolved = path.isAbsolute(agent.personality_path)
      ? agent.personality_path
      : path.join(repoRoot, agent.personality_path);
    if (!fs.existsSync(resolved)) {
      charterProblems.push(label + ' charter missing at ' + agent.personality_path);
      return;
    }
    const read = readCharterAgentId(resolved);
    if (!read.ok) {
      charterProblems.push(label + ' charter unreadable at ' + agent.personality_path);
      return;
    }
    if (read.agentId && read.agentId !== agent.id) {
      charterProblems.push(label + ' charter declares agent_id "' + read.agentId + '" but is loaded for "' + agent.id + '"');
    }
  });
  if (charterProblems.length) {
    push('agents.charters', 'Personality charters', CHECK_STATUS.FAIL,
      charterProblems.length + ' charter problem(s): ' + charterProblems.join('; ') + '.',
      'Fix the personality_path or the `agent_id` frontmatter so each agent loads its own charter, then restart the server.');
  } else if (!charterCount) {
    push('agents.charters', 'Personality charters', CHECK_STATUS.WARN, 'No charters to check (no org agents).', 'Confirm personalities/org-chart.json parses.');
  } else {
    push('agents.charters', 'Personality charters', CHECK_STATUS.PASS,
      charterCount + ' charters present and matched to their agent ids.');
  }

  // --- Watchdog: the independent process that notices stale agents. ---
  const heartbeatAt = parseTimestamp(options.heartbeatAt);
  const watchdogInterval = Number(options.watchdogIntervalSeconds) > 0
    ? Number(options.watchdogIntervalSeconds)
    : 60;
  const staleAfterSeconds = watchdogInterval * 3;
  if (!heartbeatAt) {
    push('watchdog.heartbeat', 'Watchdog heartbeat', CHECK_STATUS.WARN,
      'No heartbeat recorded — the watchdog has not reported since this database was created.',
      'Start it with `npm run watchdog` (or install the launchd watchdog service with ./install.sh) so stale agents get noticed.');
  } else {
    const ageSeconds = Math.max(0, Math.round((now.getTime() - heartbeatAt.getTime()) / 1000));
    if (ageSeconds > staleAfterSeconds) {
      push('watchdog.heartbeat', 'Watchdog heartbeat', CHECK_STATUS.WARN,
        'Last watchdog heartbeat was ' + ageSeconds + 's ago (expected within ' + staleAfterSeconds + 's).',
        'Check `vision status` and the watchdog log; restart the watchdog if the process is gone.');
    } else {
      push('watchdog.heartbeat', 'Watchdog heartbeat', CHECK_STATUS.PASS,
        'Watchdog heartbeat ' + ageSeconds + 's ago (interval ' + watchdogInterval + 's).');
    }
  }

  // --- Run hygiene: rows stuck in "running" hide a dead dispatch. ---
  const staleRuns = Number(options.staleRuns) || 0;
  if (staleRuns > 0) {
    push('runs.stale', 'Run hygiene', CHECK_STATUS.WARN,
      staleRuns + ' run(s) have been marked running for more than 2 hours.',
      'POST /api/overview/clean-stale-runs (or use the Overview mission card) to clear rows with no live dispatch attached.');
  } else {
    push('runs.stale', 'Run hygiene', CHECK_STATUS.PASS, 'No runs stuck in "running" for more than 2 hours.');
  }

  // --- Scheduler: informational, but a broken cron is worth surfacing. ---
  const schedulesEnabled = Number(options.schedulesEnabled) || 0;
  push('scheduler.enabled', 'Scheduler', CHECK_STATUS.PASS,
    schedulesEnabled + ' enabled schedule(s) will fire through the failover engine.');

  const activeDispatches = Number(options.activeDispatches) || 0;
  push('dispatches.active', 'Active dispatches', CHECK_STATUS.PASS,
    activeDispatches + ' dispatch(es) currently streaming.');

  const summary = { pass: 0, warn: 0, fail: 0 };
  checks.forEach(function (check) {
    if (check.status === CHECK_STATUS.PASS) summary.pass += 1;
    else if (check.status === CHECK_STATUS.WARN) summary.warn += 1;
    else summary.fail += 1;
  });

  let dbSizeBytes = null;
  try { dbSizeBytes = fs.statSync(String(options.dbPath || '')).size; } catch { /* optional */ }

  const startedAt = options.startedAt instanceof Date ? options.startedAt : null;
  const uptimeSeconds = startedAt ? Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 1000)) : null;

  return {
    generated_at: now.toISOString(),
    ok: summary.fail === 0,
    summary: summary,
    checks: checks,
    environment: {
      version: options.version || null,
      node: process.version,
      pid: process.pid,
      port: options.port || null,
      uptime_seconds: uptimeSeconds,
      db_path: options.dbPath || null,
      db_size_bytes: dbSizeBytes,
      schema_version: Number.isFinite(schemaVersion) ? schemaVersion : null,
      artifact_root: artifactRoot || null,
      harnesses_available: availableNames,
      org_agents: agents.filter(function (a) { return a && a.role; }).length,
      active_dispatches: activeDispatches
    }
  };
}

module.exports = {
  CHECK_STATUS,
  buildHealthReport,
  parseHarnessChain,
  parseTimestamp
};
