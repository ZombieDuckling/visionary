'use strict';

// Project resume brief: a deterministic, copyable snapshot of where a project's
// work actually stands, so a fresh session (human or agent) can pick it up
// without re-reading the board, the run log, the decision ledger, and the
// artifact index separately.
//
// Inspired by Jake Van Clief's handoff/fresh-session tests (videos 6AzLk2-kWyY
// and Dvzh9wUUYtQ): the end of a workflow is the most expensive place to fix
// anything, and a workflow is only handed over successfully when the next
// session can name the state, the standing decisions, the artifacts that still
// exist, the blockers, and the next action from recorded evidence — not from a
// chat summary or a guess.
//
// Discipline: this module reads only what the caller passes in. Every action
// and blocker cites the task id, run id, decision id, or artifact path it came
// from. A `running` row is reported as a claim, not as proof a process exists.
// Nothing is inferred beyond the recorded state, and unavailable inputs are
// reported as unavailable rather than treated as empty.

const LIMITS = {
  max_actions: 8,
  max_blockers: 8,
  max_tasks_per_bucket: 6,
  max_decisions: 6,
  max_artifacts: 8,
  max_failed_runs: 5,
  max_error_chars: 180,
  max_title_chars: 90,
  max_description_chars: 240,
  run_history_cap: 20
};

const DEFAULTS = {
  stale_run_hours: 2,
  review_stale_hours: 72
};

const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

function singleLine(value, max) {
  const text = String(value === null || value === undefined ? '' : value)
    .replace(/\s+/g, ' ')
    .trim();
  if (!max || text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

function parseTime(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  // SQLite datetime('now') yields "YYYY-MM-DD HH:MM:SS" in UTC.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    const ms = Date.parse(text.replace(' ', 'T') + 'Z');
    return Number.isNaN(ms) ? null : ms;
  }
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
}

function isoOrNull(value) {
  const ms = parseTime(value);
  return ms === null ? null : new Date(ms).toISOString();
}

function hoursBetween(nowMs, thenMs) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(thenMs)) return null;
  return Math.max(0, (nowMs - thenMs) / 3600000);
}

function formatAge(hours) {
  if (hours === null) return 'age unknown';
  if (hours < 1) return Math.max(1, Math.round(hours * 60)) + 'm ago';
  if (hours < 48) return Math.round(hours) + 'h ago';
  return Math.round(hours / 24) + 'd ago';
}

function priorityRank(value) {
  const key = String(value || 'medium').toLowerCase();
  return Object.prototype.hasOwnProperty.call(PRIORITY_RANK, key) ? PRIORITY_RANK[key] : 2;
}

function countByStatus(tasks) {
  const counts = { todo: 0, in_progress: 0, review: 0, done: 0 };
  for (const task of tasks) {
    const status = String(task.status || 'todo');
    if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
  }
  return counts;
}

function artifactCountForRun(run) {
  if (!run || !run.artifacts_json) return 0;
  try {
    const parsed = JSON.parse(run.artifacts_json);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function normalizeRun(run) {
  return {
    id: Number(run.id || run.run_id || 0),
    task_id: run.task_id === null || run.task_id === undefined ? null : Number(run.task_id),
    agent_id: singleLine(run.agent_id, 40) || 'unknown',
    status: String(run.status || 'unknown'),
    error: singleLine(run.error, LIMITS.max_error_chars),
    workdir: run.workdir || null,
    created_at: run.created_at || null,
    completed_at: run.completed_at || null,
    duration_ms: Number.isFinite(Number(run.duration_ms)) ? Number(run.duration_ms) : null,
    artifacts_recorded: artifactCountForRun(run),
    created_ms: parseTime(run.created_at)
  };
}

function newestRunByTask(runs) {
  const newest = new Map();
  for (const run of runs) {
    if (run.task_id === null) continue;
    const key = String(run.task_id);
    const current = newest.get(key);
    if (!current) { newest.set(key, run); continue; }
    const runTime = run.created_ms === null ? -Infinity : run.created_ms;
    const currentTime = current.created_ms === null ? -Infinity : current.created_ms;
    if (runTime > currentTime || (runTime === currentTime && run.id > current.id)) {
      newest.set(key, run);
    }
  }
  return newest;
}

function liveRuns(runs) {
  return runs.filter(function (run) { return run.status === 'pending' || run.status === 'running'; });
}

function artifactsByTask(artifacts) {
  const map = new Map();
  const groups = artifacts && Array.isArray(artifacts.tasks) ? artifacts.tasks : [];
  for (const group of groups) {
    if (!group || group.task_id === null || group.task_id === undefined) continue;
    let present = 0;
    let missing = 0;
    for (const file of group.files || []) {
      if (file.exists === false) missing += 1;
      else present += 1;
    }
    map.set(String(group.task_id), {
      files: (group.files || []).length,
      present: present,
      missing: missing
    });
  }
  return map;
}

function buildProjectHandoff(input, opts) {
  const options = Object.assign({}, DEFAULTS, LIMITS, opts || {});
  const project = (input && input.project) || {};
  const nowMs = parseTime((input && input.now) || new Date().toISOString());
  if (nowMs === null) throw new Error('buildProjectHandoff: invalid now value');

  const rawTasks = input && Array.isArray(input.tasks) ? input.tasks.filter(Boolean) : [];
  const rawRuns = input && Array.isArray(input.runs) ? input.runs.filter(Boolean) : [];
  const ledger = (input && input.ledger) || null;
  const artifacts = (input && input.artifacts) || null;

  const tasks = rawTasks.map(function (task) {
    return {
      id: Number(task.id || 0),
      title: singleLine(task.title, LIMITS.max_title_chars) || '(untitled task)',
      description: singleLine(task.description, LIMITS.max_description_chars),
      status: String(task.status || 'todo'),
      priority: String(task.priority || 'medium'),
      agent_id: task.agent_id || null,
      created_at: task.created_at || null,
      updated_at: task.updated_at || null,
      completed_at: task.completed_at || null,
      updated_ms: parseTime(task.updated_at || task.created_at)
    };
  });

  const runs = rawRuns.map(normalizeRun);
  const newestByTask = newestRunByTask(runs);
  const live = liveRuns(runs);
  const artifactMap = artifactsByTask(artifacts);

  const taskById = new Map();
  for (const task of tasks) taskById.set(String(task.id), task);

  const statusCounts = countByStatus(tasks);
  const actions = [];
  const claimedTasks = new Set();
  const blockers = [];
  const warnings = [];

  function addAction(kind, rank, title, evidence, taskId) {
    if (actions.length >= options.max_actions) return false;
    if (taskId !== null && taskId !== undefined && claimedTasks.has(String(taskId))) return false;
    if (taskId !== null && taskId !== undefined) claimedTasks.add(String(taskId));
    actions.push({ kind: kind, rank: rank, title: title, evidence: evidence });
    return true;
  }

  // 1. Review first: a task in review is waiting on a human decision, and every
  // later run is blocked behind it. Oldest first — the longest wait is the one
  // most likely to be forgotten.
  const reviewTasks = tasks
    .filter(function (task) { return task.status === 'review'; })
    .sort(function (a, b) {
      const at = a.updated_ms === null ? Infinity : a.updated_ms;
      const bt = b.updated_ms === null ? Infinity : b.updated_ms;
      if (at !== bt) return at - bt;
      return a.id - b.id;
    });

  for (const task of reviewTasks) {
    const latest = newestByTask.get(String(task.id)) || null;
    const evidence = latest
      ? 'task #' + task.id + ' · status review · latest run #' + latest.id + ' ' + latest.status
        + ' (' + formatAge(hoursBetween(nowMs, latest.created_ms)) + ') · '
        + latest.artifacts_recorded + ' artifact(s) recorded'
      : 'task #' + task.id + ' · status review · no run recorded';
    addAction('review', 0, 'Review task #' + task.id + ' "' + task.title + '"', evidence, task.id);
  }

  // 2. Live runs that are older than the stale threshold are claims that need
  // checking before the operator redispatchs into a duplicate.
  for (const run of live) {
    const age = hoursBetween(nowMs, run.created_ms);
    if (age === null || age < options.stale_run_hours) continue;
    const task = run.task_id === null ? null : taskById.get(String(run.task_id));
    addAction(
      'stale_run',
      1,
      'Check run #' + run.id + ' before redispatching',
      'run #' + run.id + ' · ' + run.agent_id + ' · reports ' + run.status
        + ' since ' + (isoOrNull(run.created_at) || 'unknown') + ' (' + formatAge(age) + ')'
        + (task ? ' · task #' + task.id + ' "' + task.title + '"' : ''),
      run.task_id
    );
  }

  // 3. A newest run that failed on a non-done task is the retry candidate; the
  // error travels with the action so the next attempt does not repeat it blind.
  // Retry outranks a generic "resume" because it names the specific failure.
  const failedCandidates = [];
  for (const task of tasks) {
    if (task.status === 'done') continue;
    const latest = newestByTask.get(String(task.id)) || null;
    if (!latest || latest.status !== 'failed') continue;
    failedCandidates.push({ task: task, run: latest });
  }
  failedCandidates.sort(function (a, b) {
    const at = a.run.created_ms === null ? -Infinity : a.run.created_ms;
    const bt = b.run.created_ms === null ? -Infinity : b.run.created_ms;
    return bt - at;
  });
  for (const candidate of failedCandidates) {
    const task = candidate.task;
    const run = candidate.run;
    const evidence = 'task #' + task.id + ' · run #' + run.id + ' (' + run.agent_id + ') failed '
      + formatAge(hoursBetween(nowMs, run.created_ms))
      + (run.error ? ' · ' + run.error : ' · no error recorded')
      + ' · workdir ' + (run.workdir || 'not recorded');
    addAction('retry', 2, 'Retry task #' + task.id + ' "' + task.title + '"', evidence, task.id);
  }

  // 4. A task marked in progress with no live run and no failed newest run is
  // either finished-but-not-marked or stalled; both need a human look.
  for (const task of tasks) {
    if (task.status !== 'in_progress') continue;
    const latest = newestByTask.get(String(task.id)) || null;
    const hasLive = live.some(function (run) { return String(run.task_id) === String(task.id); });
    if (hasLive) continue;
    if (latest && latest.status === 'failed') continue;
    const evidence = latest
      ? 'task #' + task.id + ' · status in_progress · latest run #' + latest.id + ' ' + latest.status
        + ' (' + formatAge(hoursBetween(nowMs, latest.created_ms)) + ') · no live run recorded'
      : 'task #' + task.id + ' · status in_progress · no run recorded';
    addAction('resume', 3, 'Resume or re-mark task #' + task.id + ' "' + task.title + '"', evidence, task.id);
  }

  // 5. Recorded artifacts that are no longer on disk are the cheapest place for
  // a "done" claim to be wrong; verify before trusting the outcome.
  const missingArtifacts = artifacts && Array.isArray(artifacts.missing) ? artifacts.missing : [];
  if (missingArtifacts.length) {
    const sample = missingArtifacts.slice(0, 3).map(function (entry) {
      return entry.path + ' (run #' + entry.run_id + (entry.reason ? ', ' + entry.reason : '') + ')';
    });
    addAction(
      'verify_artifacts',
      4,
      'Verify ' + missingArtifacts.length + ' recorded artifact(s) that are missing on disk',
      sample.join(' · ') + (missingArtifacts.length > sample.length
        ? ' · +' + (missingArtifacts.length - sample.length) + ' more'
        : '')
    );
  }

  // 6. A done task with no artifact recorded has a claim but no evidence on
  // disk. Do not silently re-open it — ask the operator to confirm the outcome.
  const doneWithoutArtifacts = tasks.filter(function (task) {
    if (task.status !== 'done') return false;
    const recorded = artifactMap.get(String(task.id));
    return !recorded || recorded.files === 0;
  });
  for (const task of doneWithoutArtifacts.slice(0, 2)) {
    const latest = newestByTask.get(String(task.id)) || null;
    addAction(
      'verify_outcome',
      5,
      'Confirm the outcome for task #' + task.id + ' "' + task.title + '"',
      'task #' + task.id + ' is done · no artifact recorded'
        + (latest ? ' · latest run #' + latest.id + ' ' + latest.status : ' · no run recorded'),
      task.id
    );
  }

  // 7. Todo tasks with no run at all are the dispatch queue, ordered by stated
  // priority so the brief does not invent a priority of its own.
  const neverDispatched = tasks
    .filter(function (task) {
      return task.status === 'todo' && !newestByTask.has(String(task.id));
    })
    .sort(function (a, b) {
      const pr = priorityRank(a.priority) - priorityRank(b.priority);
      if (pr !== 0) return pr;
      return a.id - b.id;
    });
  for (const task of neverDispatched.slice(0, 3)) {
    addAction(
      'dispatch',
      6,
      'Dispatch task #' + task.id + ' "' + task.title + '"',
      'task #' + task.id + ' · status todo · priority ' + task.priority + ' · never dispatched'
        + (task.agent_id ? ' · assigned ' + task.agent_id : ' · unassigned'),
      task.id
    );
  }

  // 8. Standing intent: a project with live work and no accepted decision has
  // no recorded "why" for the next agent to obey.
  const decisionTotals = ledger && ledger.totals ? ledger.totals : null;
  if (tasks.length && (!decisionTotals || !decisionTotals.accepted)) {
    addAction(
      'record_decision',
      7,
      'Record the standing decision for this project',
      'no accepted decision in the ledger · agents have no recorded constraint to obey',
      null
    );
  }

  if (decisionTotals && (decisionTotals.stale > 0 || decisionTotals.undated > 0)) {
    addAction(
      'confirm_decision',
      8,
      'Re-confirm ' + (decisionTotals.stale + decisionTotals.undated) + ' accepted decision(s)',
      decisionTotals.stale + ' stale (>180 days) · ' + decisionTotals.undated + ' undated'
        + ' · agents currently treat them as current',
      null
    );
  }

  if (!tasks.length) {
    addAction('define_work', 9, 'Define the first task for this project',
      'no tasks recorded · nothing to dispatch or resume', null);
  }

  // Blockers are recorded facts that stand between the current state and a
  // trustworthy "done". They are not a second action list.
  for (const candidate of failedCandidates.slice(0, options.max_failed_runs)) {
    blockers.push({
      kind: 'failed_run',
      text: 'run #' + candidate.run.id + ' failed for task #' + candidate.task.id
        + (candidate.run.error ? ' — ' + candidate.run.error : ' — no error recorded')
    });
  }
  for (const entry of missingArtifacts.slice(0, 5)) {
    blockers.push({
      kind: 'missing_artifact',
      text: entry.path + ' recorded by run #' + entry.run_id
        + ' (task #' + (entry.task_id || '?') + ') is not on disk'
        + (entry.reason ? ' — ' + entry.reason : '')
    });
  }
  for (const run of live) {
    const age = hoursBetween(nowMs, run.created_ms);
    if (age !== null && age >= options.stale_run_hours) {
      blockers.push({
        kind: 'stale_run',
        text: 'run #' + run.id + ' reports ' + run.status + ' since '
          + (isoOrNull(run.created_at) || 'unknown') + ' (' + formatAge(age)
          + ') — a live row is a claim, not proof the harness child still exists'
      });
    }
  }
  for (const task of reviewTasks) {
    const age = hoursBetween(nowMs, task.updated_ms);
    if (age !== null && age >= options.review_stale_hours) {
      blockers.push({
        kind: 'stale_review',
        text: 'task #' + task.id + ' "' + task.title + '" has been in review for ' + formatAge(age)
      });
    }
  }
  if (decisionTotals && decisionTotals.undated > 0) {
    blockers.push({ kind: 'undated_decision', text: decisionTotals.undated + ' accepted decision(s) have no decided_at date' });
  }
  if (decisionTotals && decisionTotals.stale > 0) {
    blockers.push({ kind: 'stale_decision', text: decisionTotals.stale + ' accepted decision(s) are older than 180 days' });
  }
  const blockerList = blockers.slice(0, options.max_blockers);

  // Warnings describe the limits of this brief, not the project's failures.
  if (!tasks.length) warnings.push('No tasks recorded; the brief has nothing to resume.');
  if (!runs.length) warnings.push('No runs recorded; every task outcome is unverified by execution.');
  if (!ledger) warnings.push('Decision ledger unavailable; standing constraints are unknown, not empty.');
  if (!artifacts) warnings.push('Artifact index unavailable; on-disk files were not verified.');
  if (runs.length >= options.run_history_cap) {
    warnings.push('Run history is capped at the newest ' + options.run_history_cap + ' rows; older runs are not represented.');
  }
  if (ledger && ledger.truncated) warnings.push('Decision ledger is truncated; older decisions are not represented.');
  if (artifacts && artifacts.truncated) warnings.push('Artifact index is truncated; not every recorded file was verified.');

  const latestRun = runs.length
    ? runs.slice().sort(function (a, b) {
      const at = a.created_ms === null ? -Infinity : a.created_ms;
      const bt = b.created_ms === null ? -Infinity : b.created_ms;
      if (at !== bt) return bt - at;
      return b.id - a.id;
    })[0]
    : null;

  const acceptedDecisions = ledger && Array.isArray(ledger.decisions)
    ? ledger.decisions.filter(function (record) { return record && record.status === 'accepted'; })
    : [];

  const snapshot = {
    generated_at: new Date(nowMs).toISOString(),
    project: {
      id: Number(project.id || 0),
      name: singleLine(project.name, LIMITS.max_title_chars),
      slug: project.slug || null,
      status: project.status || null,
      description: singleLine(project.description, LIMITS.max_description_chars)
    },
    tasks: {
      total: tasks.length,
      by_status: statusCounts,
      review_waiting: reviewTasks.length,
      never_dispatched: neverDispatched.length,
      done_without_artifacts: doneWithoutArtifacts.length
    },
    runs: {
      scanned: runs.length,
      live: live.length,
      failed: runs.filter(function (run) { return run.status === 'failed'; }).length,
      latest: latestRun ? {
        id: latestRun.id,
        task_id: latestRun.task_id,
        agent_id: latestRun.agent_id,
        status: latestRun.status,
        created_at: isoOrNull(latestRun.created_at),
        completed_at: isoOrNull(latestRun.completed_at),
        workdir: latestRun.workdir,
        artifacts_recorded: latestRun.artifacts_recorded
      } : null
    },
    decisions: decisionTotals ? {
      total: decisionTotals.total,
      accepted: decisionTotals.accepted,
      proposed: decisionTotals.proposed,
      stale: decisionTotals.stale,
      undated: decisionTotals.undated
    } : null,
    artifacts: artifacts && artifacts.totals ? {
      files_recorded: artifacts.totals.files_recorded,
      files_present: artifacts.totals.files_present,
      files_missing: artifacts.totals.files_missing,
      workdirs_missing: artifacts.totals.workdirs_missing
    } : null
  };

  const startHere = actions.length ? actions[0] : null;

  const markdown = buildMarkdown({
    project: snapshot.project,
    snapshot: snapshot,
    actions: actions,
    blockers: blockerList,
    warnings: warnings,
    tasks: tasks,
    reviewTasks: reviewTasks,
    inProgress: tasks.filter(function (task) { return task.status === 'in_progress'; }),
    todoTasks: tasks.filter(function (task) { return task.status === 'todo'; }),
    newestByTask: newestByTask,
    artifactMap: artifactMap,
    acceptedDecisions: acceptedDecisions,
    latestRun: latestRun,
    nowMs: nowMs,
    options: options
  });

  return {
    ok: true,
    generated_at: snapshot.generated_at,
    project: snapshot.project,
    snapshot: snapshot,
    start_here: startHere,
    next_actions: actions,
    blockers: blockerList,
    warnings: warnings,
    markdown: markdown
  };
}

function buildMarkdown(ctx) {
  const project = ctx.project;
  const snapshot = ctx.snapshot;
  const options = ctx.options;
  const lines = [];

  lines.push('# Resume brief — ' + (project.name || 'Untitled project'));
  lines.push('');
  lines.push('Snapshot: ' + snapshot.generated_at + ' · read-only · project #'
    + project.id + (project.slug ? ' (' + project.slug + ')' : '')
    + (project.status ? ' · status ' + project.status : ''));
  if (project.description) {
    lines.push(project.description);
    lines.push('');
  }
  lines.push('This is the recorded state, not a summary of intentions. A `running` row is a claim;'
    + ' verify an artifact before treating a task as done.');
  lines.push('');

  lines.push('## Start here');
  if (ctx.actions.length) {
    lines.push('**' + ctx.actions[0].title + '**');
    lines.push('');
    lines.push('Evidence: ' + ctx.actions[0].evidence);
  } else {
    lines.push('Nothing is waiting on you in the recorded state.');
  }
  lines.push('');

  lines.push('## Work state');
  lines.push('- Tasks: ' + snapshot.tasks.total + ' total — '
    + snapshot.tasks.by_status.todo + ' todo, '
    + snapshot.tasks.by_status.in_progress + ' in progress, '
    + snapshot.tasks.by_status.review + ' review, '
    + snapshot.tasks.by_status.done + ' done');
  lines.push('- Runs (newest ' + options.run_history_cap + ' scanned): ' + snapshot.runs.scanned
    + ' recorded · ' + snapshot.runs.live + ' live · ' + snapshot.runs.failed + ' failed');
  if (ctx.latestRun) {
    const latest = ctx.latestRun;
    lines.push('- Latest run: #' + latest.id + ' · ' + latest.agent_id + ' · ' + latest.status
      + ' · ' + (latest.created_at || 'time unknown')
      + (latest.task_id ? ' · task #' + latest.task_id : ''));
  }
  lines.push('- Decisions: ' + (snapshot.decisions
    ? snapshot.decisions.accepted + ' accepted (' + snapshot.decisions.stale + ' stale, '
      + snapshot.decisions.undated + ' undated) · ' + snapshot.decisions.proposed + ' proposed'
    : 'unavailable'));
  lines.push('- Artifacts: ' + (snapshot.artifacts
    ? snapshot.artifacts.files_present + ' present · ' + snapshot.artifacts.files_missing
      + ' missing · ' + snapshot.artifacts.files_recorded + ' recorded'
    : 'unavailable'));
  lines.push('');

  lines.push('## Next actions');
  if (!ctx.actions.length) {
    lines.push('_None recorded._');
  } else {
    ctx.actions.forEach(function (action, index) {
      lines.push((index + 1) + '. **' + action.title + '** — ' + action.evidence);
    });
  }
  lines.push('');

  lines.push('## Open tasks');
  const openBuckets = [
    { label: 'review', items: ctx.reviewTasks },
    { label: 'in_progress', items: ctx.inProgress },
    { label: 'todo', items: ctx.todoTasks }
  ];
  let openCount = 0;
  for (const bucket of openBuckets) {
    const items = bucket.items.slice(0, options.max_tasks_per_bucket);
    for (const task of items) {
      openCount += 1;
      const latest = ctx.newestByTask.get(String(task.id)) || null;
      const recorded = ctx.artifactMap.get(String(task.id));
      const evidence = latest
        ? 'latest run #' + latest.id + ' ' + latest.status
          + ' (' + formatAge(hoursBetween(ctx.nowMs, latest.created_ms)) + ')'
        : 'never dispatched';
      lines.push('- [' + bucket.label + '] #' + task.id + ' "' + task.title + '" ('
        + task.priority + ') — ' + evidence
        + (recorded ? ' · ' + recorded.present + ' artifact(s) present' : ' · no artifact recorded'));
    }
    if (bucket.items.length > items.length) {
      lines.push('- …+' + (bucket.items.length - items.length) + ' more ' + bucket.label + ' task(s)');
    }
  }
  if (!openCount) lines.push('_No open tasks._');
  lines.push('');

  lines.push('## Accepted decisions (standing constraints)');
  if (!ctx.acceptedDecisions.length) {
    lines.push('_No accepted decision recorded; the next agent has no recorded constraint to obey._');
  } else {
    ctx.acceptedDecisions.slice(0, options.max_decisions).forEach(function (record) {
      const date = String(record.decided_at || record.created_at || '').slice(0, 10) || 'undated';
      const flags = record.flags && record.flags.length ? ' [' + record.flags.join(', ') + ']' : '';
      lines.push('- ' + date + ' · #' + record.id + ' ' + singleLine(record.title, 90) + flags);
      lines.push('  Decision: ' + singleLine(record.decision, 240));
      lines.push('  Why: ' + singleLine(record.rationale, 240)
        + (record.decided_by ? ' (decided by ' + singleLine(record.decided_by, 60) + ')' : ''));
    });
    if (ctx.acceptedDecisions.length > options.max_decisions) {
      lines.push('- …+' + (ctx.acceptedDecisions.length - options.max_decisions) + ' more accepted decision(s)');
    }
  }
  lines.push('');

  lines.push('## Blockers / unverified');
  if (!ctx.blockers.length) {
    lines.push('_None recorded._');
  } else {
    ctx.blockers.forEach(function (blocker) { lines.push('- ' + blocker.text); });
  }
  lines.push('');

  lines.push('## Latest run evidence');
  if (!ctx.latestRun) {
    lines.push('_No runs recorded._');
  } else {
    const run = ctx.latestRun;
    lines.push('- run #' + run.id + ' · ' + run.agent_id + ' · ' + run.status
      + ' · created ' + (run.created_at || 'unknown')
      + (run.completed_at ? ' · completed ' + run.completed_at : ''));
    lines.push('- workdir: ' + (run.workdir || 'not recorded'));
    lines.push('- artifacts recorded: ' + run.artifacts_recorded);
    if (run.error) lines.push('- error: ' + run.error);
  }
  lines.push('');

  lines.push('## What this brief does not know');
  lines.push('- Live process state: a `pending`/`running` row may outlive the harness child that wrote it.');
  lines.push('- File contents: artifacts are verified for existence, not read.');
  lines.push('- Work outside the recorded workdir and outside SQLite (chat, terminal, Telegram).');
  lines.push('');

  if (ctx.warnings.length) {
    lines.push('## Brief limits');
    ctx.warnings.forEach(function (warning) { lines.push('- ' + warning); });
    lines.push('');
  }

  lines.push('## Paste-ready instruction');
  lines.push('Resume project "' + (project.name || 'Untitled project') + '" from this brief. Treat the accepted'
    + ' decisions as standing constraints; do not contradict one without recording a new decision.'
    + ' Verify any artifact you rely on before treating a task as done.'
    + (ctx.actions.length ? ' Start with: ' + ctx.actions[0].title + '.' : ''));

  return lines.join('\n');
}

module.exports = { buildProjectHandoff, LIMITS, DEFAULTS };
