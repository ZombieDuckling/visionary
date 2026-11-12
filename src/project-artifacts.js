'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Project-level artifact index.
//
// Agent work is only useful when its output survives as an inspectable file.
// Runs already record a workdir and an artifact list, but that history is
// scattered across task cards: there is no single place to see what a project's
// agents have produced, whether those files still exist, or which run owns a
// missing artifact. This module builds that index deterministically from stored
// run rows — no new tables, no background scanner.
//
// Applies Jake Van Clief's workbench lesson (`ai-workbench-components`): a
// workbench needs a canonical manifest and a review surface over the artifacts,
// not just a generation step. It also applies `position-addressed-memory`:
// keep the path relative to the run workdir so the location itself carries the
// meaning, and keep the workdir visible so a human can navigate to it.
//
// Safety posture: artifact paths are untrusted strings from a stored JSON blob.
// Every path is resolved against the recorded workdir and must stay inside it;
// symlinks are reported but never followed for size/modified-time. A missing or
// moved workdir is reported as missing rather than guessed at.

const DEFAULTS = {
  max_files: 400,
  max_per_run: 500,
  max_missing: 100,
  max_groups: 50
};

const REASON = {
  missing: 'missing',
  workdirMissing: 'workdir_missing',
  escapesWorkdir: 'escapes_workdir',
  notAFile: 'not_a_file',
  unchecked: 'unchecked'
};

function parseArtifactList(raw, limit) {
  let parsed;
  try { parsed = JSON.parse(raw || '[]'); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const files = [];
  for (const entry of parsed.slice(0, limit)) {
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.path !== 'string' || !entry.path.trim()) continue;
    files.push({
      path: entry.path,
      size: Number.isFinite(Number(entry.size)) && Number(entry.size) >= 0 ? Number(entry.size) : null,
      modified_at: typeof entry.modified_at === 'string' ? entry.modified_at : null,
      new: entry.new === true
    });
  }
  return files;
}

function sortNewestFirst(a, b) {
  const at = String(a.created_at || '');
  const bt = String(b.created_at || '');
  if (at !== bt) return at < bt ? 1 : -1;
  return Number(b.run_id || 0) - Number(a.run_id || 0);
}

function workdirRealpath(workdir, cache) {
  if (!workdir) return null;
  if (cache.has(workdir)) return cache.get(workdir);
  let real = null;
  try {
    if (fs.lstatSync(workdir).isSymbolicLink()) {
      real = null;
    } else {
      real = fs.realpathSync(workdir);
    }
  } catch { real = null; }
  cache.set(workdir, real);
  return real;
}

// Resolve a stored relative path inside the run workdir and inspect it.
// Returns {exists, reason?, size?, modified_at?, symlink?}. Never throws.
function inspectArtifact(workdir, relPath, cache) {
  const root = workdirRealpath(workdir, cache);
  if (!root) return { exists: false, reason: REASON.workdirMissing };

  const resolved = path.resolve(root, relPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return { exists: false, reason: REASON.escapesWorkdir };
  }

  let stat;
  try { stat = fs.lstatSync(resolved); } catch { return { exists: false, reason: REASON.missing }; }

  if (stat.isSymbolicLink()) {
    return {
      exists: true,
      symlink: true,
      size: stat.size,
      modified_at: stat.mtime.toISOString()
    };
  }
  if (!stat.isFile()) return { exists: false, reason: REASON.notAFile };

  return {
    exists: true,
    size: stat.size,
    modified_at: stat.mtime.toISOString()
  };
}

function buildProjectArtifactIndex(runs, options) {
  options = Object.assign({}, DEFAULTS, options || {});
  runs = Array.isArray(runs) ? runs : [];

  const unique = new Map();
  const runsWithArtifacts = new Set();
  let runsScanned = 0;
  let recordedTotal = 0;
  const warnings = [];

  const ordered = runs.slice().sort(sortNewestFirst);
  for (const run of ordered) {
    runsScanned++;
    const files = parseArtifactList(run.artifacts_json, options.max_per_run);
    if (!files.length) continue;
    runsWithArtifacts.add(run.run_id);
    for (const file of files) {
      recordedTotal++;
      const key = String(run.workdir || '') + '\u0000' + file.path;
      const existing = unique.get(key);
      if (existing) {
        existing.occurrences += 1;
        continue;
      }
      unique.set(key, {
        path: file.path,
        run_id: run.run_id,
        task_id: run.task_id,
        task_title: run.task_title || null,
        agent_id: run.agent_id || null,
        run_status: run.status || null,
        created_at: run.created_at || null,
        workdir: run.workdir || null,
        recorded_size: file.size,
        recorded_modified_at: file.modified_at,
        new: file.new,
        occurrences: 1
      });
    }
  }

  const all = Array.from(unique.values()).sort(function (a, b) {
    const at = String(a.created_at || '');
    const bt = String(b.created_at || '');
    if (at !== bt) return at < bt ? 1 : -1;
    return Number(b.run_id || 0) - Number(a.run_id || 0);
  });

  const truncated = all.length > options.max_files;
  const indexed = all.slice(0, options.max_files);

  const realpathCache = new Map();
  const workdirs = new Set();
  const missingWorkdirs = new Set();
  const agents = new Set();
  const tasks = new Map();
  let filesPresent = 0;
  let filesMissing = 0;
  let bytesPresent = 0;
  let newestAt = null;
  const missing = [];

  for (const entry of indexed) {
    const inspected = inspectArtifact(entry.workdir, entry.path, realpathCache);
    entry.exists = inspected.exists;
    entry.size = inspected.exists ? inspected.size : entry.recorded_size;
    entry.modified_at = inspected.exists ? inspected.modified_at : entry.recorded_modified_at;
    entry.symlink = inspected.symlink === true;
    if (inspected.reason) entry.reason = inspected.reason;

    if (entry.workdir) {
      workdirs.add(entry.workdir);
      if (inspected.reason === REASON.workdirMissing) missingWorkdirs.add(entry.workdir);
    }
    if (entry.agent_id) agents.add(entry.agent_id);

    if (entry.exists) {
      filesPresent++;
      bytesPresent += Number(entry.size) || 0;
      if (entry.modified_at && (!newestAt || entry.modified_at > newestAt)) newestAt = entry.modified_at;
    } else {
      filesMissing++;
      if (missing.length < options.max_missing) {
        missing.push({
          path: entry.path,
          run_id: entry.run_id,
          task_id: entry.task_id,
          agent_id: entry.agent_id,
          reason: entry.reason || REASON.missing
        });
      }
    }

    const groupKey = String(entry.task_id || 'unassigned');
    if (!tasks.has(groupKey)) {
      tasks.set(groupKey, {
        task_id: entry.task_id || null,
        task_title: entry.task_title || null,
        files: []
      });
    }
    tasks.get(groupKey).files.push(entry);
  }

  const groups = Array.from(tasks.values())
    .filter(function (group) { return group.files.length > 0; })
    .sort(function (a, b) {
      const at = String((a.files[0] && a.files[0].created_at) || '');
      const bt = String((b.files[0] && b.files[0].created_at) || '');
      if (at !== bt) return at < bt ? 1 : -1;
      return Number(b.task_id || 0) - Number(a.task_id || 0);
    })
    .slice(0, options.max_groups);

  if (truncated) {
    warnings.push('Index capped at ' + options.max_files + ' of ' + all.length + ' recorded artifacts.');
  }
  if (missingWorkdirs.size) {
    warnings.push(missingWorkdirs.size + ' workdir(s) are missing on disk; their artifacts cannot be verified.');
  }
  if (filesMissing) {
    warnings.push(filesMissing + ' artifact(s) are recorded but no longer present on disk.');
  }

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    artifact_root: options.artifact_root || null,
    totals: {
      runs_scanned: runsScanned,
      runs_with_artifacts: runsWithArtifacts.size,
      files_recorded: recordedTotal,
      files_unique: all.length,
      files_indexed: indexed.length,
      files_present: filesPresent,
      files_missing: filesMissing,
      bytes_present: bytesPresent,
      workdirs: workdirs.size,
      workdirs_missing: missingWorkdirs.size,
      agents: Array.from(agents).sort(),
      tasks: tasks.size,
      newest_artifact_at: newestAt
    },
    truncated: truncated,
    warnings: warnings,
    tasks: groups,
    missing: missing
  };
}

module.exports = { buildProjectArtifactIndex, inspectArtifact, REASON };
