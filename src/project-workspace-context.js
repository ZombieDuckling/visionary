'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { inspectArtifact, parseArtifactList } = require('./project-artifacts');

// Project workspace context for dispatch.
//
// A task workdir is a fresh directory, but the project is not new. Prior tasks
// may already have produced the brief, the schema, the draft, or the data file
// the next agent is about to recreate. Without a workspace view the agent only
// sees its own empty folder and re-derives work that already exists on disk.
//
// Applies Jake Van Clief's workflow-specific context layers lesson
// (`-CUsfao6m7E`, concept `workflow-specific-context-layers`): a durable
// workflow folder separates raw source, derived signal, instructions, outputs,
// and state, and "how to continue the work without rereading everything" is
// part of the structure — not something the model should rediscover each run.
// It also applies `position-addressed-memory`: the workspace root plus a
// relative path tells a fresh agent where it is and what the location means.
//
// Safety and evidence posture: artifact paths are untrusted strings from a
// stored JSON blob. Every path is resolved against its recorded workdir and
// must stay inside it (the same containment check the project artifact index
// uses). A file is listed only after it is observed on disk; recorded-but-gone
// files are counted, never asserted. A missing workdir is reported as missing.
// Nothing here writes to the DB or to disk.

const DEFAULTS = {
  max_runs: 20,
  max_files_per_run: 50,
  max_tasks: 5,
  max_files_per_task: 6,
  max_chars: 1800,
  max_path_chars: 160
};

const OK_STATUSES = new Set(['completed', 'success', 'succeeded', 'done']);

function cleanText(value, maxChars) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  if (!text) return '';
  return maxChars && text.length > maxChars ? text.slice(0, maxChars) : text;
}

function shortDate(value) {
  const raw = cleanText(value, 40);
  if (!raw) return null;
  return raw.slice(0, 10);
}

function displayPath(workspaceRoot, workdir, relPath, options) {
  const absolute = path.resolve(workdir, relPath);
  let shown = absolute;
  if (workspaceRoot) {
    const relative = path.relative(workspaceRoot, absolute);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) shown = relative;
  }
  return cleanText(shown, options.max_path_chars);
}

// The workspace root is derived from the recorded workdirs themselves (the
// parent of `task-<id>`), not from the project slug: dispatch builds workdirs
// from the project *name*, so the slug can differ and would point at a folder
// that never existed.
function workspaceRootFromRuns(runs) {
  for (const run of runs) {
    const workdir = cleanText(run && run.workdir, 500);
    if (!workdir) continue;
    const parent = path.dirname(workdir);
    if (parent && parent !== workdir) return parent;
  }
  return null;
}

function workspaceRootExists(root) {
  if (!root) return false;
  try { return fs.statSync(root).isDirectory(); } catch { return false; }
}

// Build the per-task workspace view from stored run rows. `inspect` is
// injectable so tests can pin filesystem outcomes without touching disk.
function buildProjectWorkspaceContext(input, options) {
  options = Object.assign({}, DEFAULTS, options || {});
  const project = (input && input.project) || null;
  const allRuns = Array.isArray(input && input.runs) ? input.runs : [];
  const runs = allRuns.slice(0, options.max_runs);
  const inspect = typeof options.inspect === 'function' ? options.inspect : inspectArtifact;

  const workspaceRoot = workspaceRootFromRuns(runs);
  const warnings = [];
  const groups = new Map();
  const realpathCache = new Map();
  let runsWithArtifacts = 0;
  let filesPresent = 0;
  let filesMissing = 0;
  let workdirsMissing = 0;

  for (const run of runs) {
    const files = parseArtifactList(run && run.artifacts_json, options.max_files_per_run);
    if (!files.length) continue;
    runsWithArtifacts += 1;

    const taskId = run.task_id === undefined ? null : run.task_id;
    const key = String(taskId === null ? 'unassigned' : taskId);
    if (!groups.has(key)) {
      groups.set(key, {
        task_id: taskId,
        task_title: cleanText(run.task_title, 120) || null,
        agent_id: cleanText(run.agent_id, 60) || null,
        run_id: run.run_id === undefined ? null : run.run_id,
        run_status: cleanText(run.status, 40) || null,
        created_at: cleanText(run.created_at, 40) || null,
        workdir: cleanText(run.workdir, 500) || null,
        files: [],
        missing: 0,
        workdir_missing: false
      });
    }
    const group = groups.get(key);
    for (const file of files) {
      const inspected = inspect(group.workdir, file.path, realpathCache);
      if (inspected.reason === 'workdir_missing') group.workdir_missing = true;
      if (!inspected.exists) {
        group.missing += 1;
        filesMissing += 1;
        continue;
      }
      // A symlink is reported by the artifact index as present but not
      // followed for size/mtime. For prompt context the path is still real and
      // readable, so it can be listed; only the size stays unknown.
      const absolute = path.resolve(group.workdir, file.path);
      group.files.push({
        path: displayPath(workspaceRoot, group.workdir, file.path, options),
        absolute_path: absolute,
        size: Number.isFinite(Number(inspected.size)) ? Number(inspected.size) : null,
        symlink: inspected.symlink === true
      });
      filesPresent += 1;
    }
  }

  if (allRuns.length > runs.length) {
    warnings.push('Workspace context inspected the newest ' + runs.length + ' of ' + allRuns.length + ' artifact-bearing runs.');
  }
  if (filesMissing > 0) {
    warnings.push(filesMissing + ' recorded file(s) are no longer present on disk.');
  }
  if (workspaceRoot && !workspaceRootExists(workspaceRoot)) {
    warnings.push('Project workspace root is not present on disk: ' + workspaceRoot);
  }

  // Only tasks with at least one verified file are worth a prompt line. A task
  // whose files are all gone is represented by the missing-file count instead
  // of a line saying "nothing here".
  workdirsMissing = Array.from(groups.values()).filter(function (group) {
    return group.workdir_missing;
  }).length;
  const tasks = Array.from(groups.values())
    .filter(function (group) {
      return group.files.length > 0;
    })
    .sort(function (a, b) {
      const at = String(a.created_at || '');
      const bt = String(b.created_at || '');
      if (at !== bt) return at < bt ? 1 : -1;
      return Number(b.run_id || 0) - Number(a.run_id || 0);
    })
    .map(function (group) {
      const files = group.files
        .slice()
        .sort(function (a, b) { return String(a.path).localeCompare(String(b.path)); })
        .slice(0, options.max_files_per_task);
      return {
        task_id: group.task_id,
        task_title: group.task_title,
        agent_id: group.agent_id,
        run_id: group.run_id,
        run_status: group.run_status,
        created_at: group.created_at,
        workdir: group.workdir,
        workdir_missing: group.workdir_missing,
        files: files,
        files_recorded_present: group.files.length,
        files_omitted: Math.max(0, group.files.length - files.length),
        files_missing: group.missing
      };
    });

  return {
    ok: true,
    project_id: project ? project.id : null,
    project_name: project ? project.name : null,
    workspace_root: workspaceRoot,
    workspace_root_exists: workspaceRootExists(workspaceRoot),
    tasks: tasks,
    totals: {
      runs_considered: runs.length,
      runs_with_artifacts: runsWithArtifacts,
      tasks_with_present_files: tasks.length,
      files_present: filesPresent,
      files_missing: filesMissing,
      workdirs_missing: workdirsMissing
    },
    warnings: warnings,
    truncated: allRuns.length > runs.length
  };
}

// Render a bounded prompt block. Tasks are dropped whole when the character
// budget would be exceeded; the newest task always lands so the block never
// degrades into a header with no evidence.
function renderProjectWorkspacePromptBlock(context, options) {
  options = Object.assign({}, DEFAULTS, options || {});
  const ctx = context || {};
  const tasks = Array.isArray(ctx.tasks) ? ctx.tasks : [];
  if (!tasks.length) return null;

  const header = '[PROJECT WORKSPACE — prior recorded work for this project. Read what already exists before writing; do not redo it.]\n'
    + 'Workspace: ' + cleanText(ctx.workspace_root, 300) + ' (listed paths are relative to it unless absolute)';
  const footer = 'Your own task workdir is separate: write new files there and reference these paths instead of copying them. '
    + 'A recorded path is not proof the file exists — verify before relying on it.';

  const lines = [];
  const taskIds = [];
  let chars = header.length + footer.length + 1;
  let dropped = 0;
  let filesListed = 0;

  for (const task of tasks) {
    if (lines.length >= options.max_tasks) { dropped += 1; continue; }
    const files = Array.isArray(task.files) ? task.files : [];
    if (!files.length) { dropped += 1; continue; }
    const label = task.task_id === null || task.task_id === undefined ? 'task ?' : 'task #' + task.task_id;
    const title = task.task_title ? ' "' + cleanText(task.task_title, 80) + '"' : '';
    const agent = task.agent_id ? ' · ' + cleanText(task.agent_id, 40) : '';
    const status = cleanText(task.run_status, 40) || 'unknown';
    const date = shortDate(task.created_at);
    const flag = OK_STATUSES.has(status) ? '' : ' [run ' + status + ' — files may be partial]';
    const paths = files.map(function (file) { return file.path; }).join(', ');
    const omitted = task.files_omitted > 0 ? ' (+' + task.files_omitted + ' more)' : '';
    const line = '- ' + label + title + agent + ' · ' + status + (date ? ' · ' + date : '') + ': ' + paths + omitted + flag;

    // Drop whole lines, not sentences: a half-listed task reads as a complete
    // one. The first line is kept even over budget so evidence always lands.
    if (lines.length > 0 && chars + 1 + line.length > options.max_chars) { dropped += 1; continue; }
    lines.push(line);
    chars += 1 + line.length;
    if (task.task_id !== null && task.task_id !== undefined) taskIds.push(task.task_id);
    filesListed += files.length;
  }

  const missing = Number(ctx.totals && ctx.totals.files_missing) || 0;
  const missingLine = missing > 0
    ? '\n' + missing + ' recorded file(s) are no longer on disk.'
    : '';
  const text = header + '\n' + lines.join('\n') + missingLine + '\n' + footer;

  return {
    text: text,
    count: lines.length,
    chars: text.length,
    task_ids: taskIds,
    files_listed: filesListed,
    dropped: dropped
  };
}

module.exports = {
  DEFAULTS,
  buildProjectWorkspaceContext,
  renderProjectWorkspacePromptBlock,
  workspaceRootFromRuns
};
