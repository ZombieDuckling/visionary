'use strict';

// Restart reconciliation for agent runs that claim to still be live.
//
// Visionary dispatches real CLI harnesses and records every run in `agent_runs`.
// A run row is marked `running` at dispatch and only becomes terminal when the
// owning server process calls `finishDispatch`. If the server is killed (SIGKILL,
// a crash, a laptop sleep that ends the process, `vision restart`), that callback
// never fires: the row stays `running` forever, the Overview counts the agent as
// live, and the board shows work in progress that no process is doing. The
// in-memory `activeDispatches` map dies with the process, so no later request can
// tell a live run from a phantom one.
//
// This module reconciles that surviving state with the truth:
//   - at boot, after the server has successfully bound its port (so a second
//     instance that loses the port race never touches rows another process owns),
//     every `pending`/`running` row is interrupted, because no dispatch in the
//     new process can own a run created by a dead one;
//   - at shutdown, the run ids this process actually owns are interrupted before
//     the DB closes, so a clean stop also leaves truthful rows instead of phantom
//     ones.
//
// Interrupted runs become `timeout` with an explicit error that says what
// happened, when, and that files written before the interruption are still in the
// workdir. The update is guarded by the prior status (`WHERE status IN
// ('pending','running')`) so a concurrent completion can never be overwritten and
// a second pass is a no-op. Task status is deliberately left alone: a task whose
// run was interrupted may still hold work worth reviewing, and moving it is the
// operator's call, not a guess made by boot code.
//
// Applies Jake Van Clief's program-decomposition lesson (`jjV1ckgPzI0`, concept
// `ai-is-part-of-a-program`): the program is instructions + runner + surviving
// state + hand-back surface + provenance, so surviving state must be reconciled
// on restart rather than trusted. It also applies the execution-evidence lesson:
// a recorded status is evidence, not truth — a row that says `running` while no
// dispatch is attached is reported as interrupted, never smoothed over.

const LIVE_RUN_STATUSES = ['pending', 'running'];

function normalizeAt(now) {
  if (now instanceof Date && !Number.isNaN(now.getTime())) return now.toISOString();
  if (typeof now === 'string' && now.trim()) {
    const parsed = new Date(now);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function buildInterruptMessage(source, at, priorStatus, signal) {
  if (source === 'shutdown') {
    return 'Interrupted: Visionary shut down (' + (signal || 'signal') + ') at ' + at
      + ' while this run was still ' + priorStatus + '. The harness child was terminated;'
      + ' any files it wrote before termination remain in the run workdir.';
  }
  return 'Interrupted: Visionary started at ' + at + ' and no live dispatch owned this run,'
    + ' which was left ' + priorStatus + ' by a previous server process. Any files the harness'
    + ' wrote before that process exited remain in the run workdir.';
}

// Reconcile run rows that cannot still be live.
//
// options.stmts        required — must expose getOrphanedRuns + markRunInterrupted
//                      (and getRunById when runIds is supplied)
// options.source       'boot' (default) or 'shutdown'
// options.runIds       optional array — reconcile only these ids (shutdown path).
//                      Without it, every pending/running row is reconciled (boot).
// options.signal       optional label recorded in the shutdown message
// options.now          optional Date/ISO string used in the recorded message
//
// Returns { source, at, count, reconciled, skipped, task_ids }.
// `reconciled` entries carry id, task_id, agent_id, prior_status, started_at and
// the error text written to the row, so the caller can log + notify without
// re-reading the DB.
function reconcileOrphanedRuns(options) {
  const opts = options || {};
  const stmts = opts.stmts;
  if (!stmts || !stmts.getOrphanedRuns || !stmts.markRunInterrupted) {
    throw new TypeError('reconcileOrphanedRuns requires stmts.getOrphanedRuns and stmts.markRunInterrupted');
  }
  const useIds = Array.isArray(opts.runIds);
  if (useIds && !stmts.getRunById) {
    throw new TypeError('reconcileOrphanedRuns with runIds requires stmts.getRunById');
  }

  const source = opts.source === 'shutdown' ? 'shutdown' : 'boot';
  const at = normalizeAt(opts.now);

  let candidates;
  if (useIds) {
    candidates = [];
    for (const rawId of opts.runIds) {
      const id = Number(rawId);
      if (!Number.isFinite(id)) continue;
      const row = stmts.getRunById.get(id);
      if (row) candidates.push(row);
    }
  } else {
    candidates = stmts.getOrphanedRuns.all();
  }

  const seen = new Set();
  const reconciled = [];
  const skipped = [];
  const taskIds = [];

  for (const row of candidates) {
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);

    if (LIVE_RUN_STATUSES.indexOf(row.status) === -1) {
      skipped.push({ id: row.id, reason: 'not_live', status: row.status });
      continue;
    }

    const error = buildInterruptMessage(source, at, row.status, opts.signal);
    let info;
    try {
      info = stmts.markRunInterrupted.run({ id: row.id, error });
    } catch (err) {
      skipped.push({ id: row.id, reason: 'write_failed', error: (err && err.message) || String(err) });
      continue;
    }
    if (!info || info.changes === 0) {
      // A concurrent completion won the race; leave its terminal state alone.
      skipped.push({ id: row.id, reason: 'already_terminal' });
      continue;
    }

    reconciled.push({
      id: row.id,
      task_id: row.task_id == null ? null : row.task_id,
      agent_id: row.agent_id,
      prior_status: row.status,
      started_at: row.started_at || null,
      error
    });
    if (row.task_id != null && taskIds.indexOf(row.task_id) === -1) taskIds.push(row.task_id);
  }

  return {
    source,
    at,
    count: reconciled.length,
    reconciled,
    skipped,
    task_ids: taskIds
  };
}

// Compact one-line summary for the activity log / notification body.
function summarizeReconciliation(result) {
  if (!result || !result.count) return 'No orphaned run rows to reconcile.';
  const ids = result.reconciled.map((r) => '#' + r.id + ' ' + r.agent_id).join(', ');
  return result.count + ' interrupted run row(s) reconciled (' + result.source + '): ' + ids;
}

module.exports = {
  LIVE_RUN_STATUSES,
  reconcileOrphanedRuns,
  summarizeReconciliation,
  buildInterruptMessage
};
