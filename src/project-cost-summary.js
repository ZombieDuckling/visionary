'use strict';

// Project cost-per-outcome summary.
//
// Jake Van Clief's cost-baseline lesson (concept `ai-cost-baseline-review`,
// applied 2026-11-16) makes one point operational: AI spend is only meaningful
// as *cost per completed outcome*, and the number is worthless if the operator
// cannot tell observed spend from a deterministic guess. Visionary already
// stores token/cost telemetry per run, but every figure was rendered identically
// — a harness-reported `total_cost_usd` and a `chars / 4` estimate looked the
// same. This module keeps the aggregate honest:
//
//   - spend is totaled across *all* runs (failed attempts are real spend), then
//     divided by tasks actually marked done, so rework shows up in the number;
//   - every cost-bearing run is attributed to `reported`, `estimated`, or
//     `unknown` (rows written before provenance was captured), and the summary
//     states that split instead of implying precision it does not have;
//   - cost per outcome is withheld (null) when there is no completed outcome,
//     rather than reporting a division by zero as "$0.00 per task";
//   - malformed rows are skipped and counted, never allowed to throw.
//
// This is the execution-evidence discipline applied to money: a dollar figure is
// a claim, so the summary names whether it was observed or inferred.

const RUN_CAP = 1000;

const PROVENANCE = { REPORTED: 'reported', ESTIMATED: 'estimated', UNKNOWN: 'unknown' };

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function round4(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function normalizeProvenance(source, hasUsage) {
  const text = String(source || '').toLowerCase();
  // `explicit` is what src/usage-telemetry.js calls harness-reported usage;
  // accept it as reported so rows written by either path are classified.
  if (text === PROVENANCE.REPORTED || text === 'explicit') return PROVENANCE.REPORTED;
  if (text === PROVENANCE.ESTIMATED) return PROVENANCE.ESTIMATED;
  return hasUsage ? PROVENANCE.UNKNOWN : null;
}

function countTasks(tasks) {
  const counts = { done: 0, review: 0, open: 0, total: 0 };
  (tasks || []).forEach(function (task) {
    counts.total += 1;
    const status = String((task && task.status) || '').toLowerCase();
    if (status === 'done') counts.done += 1;
    else if (status === 'review') counts.review += 1;
    else counts.open += 1;
  });
  return counts;
}

function dominantBasis(breakdown) {
  const kinds = [PROVENANCE.REPORTED, PROVENANCE.ESTIMATED, PROVENANCE.UNKNOWN]
    .filter(function (kind) { return breakdown[kind].runs > 0; });
  if (!kinds.length) return null;
  if (kinds.length > 1) return 'mixed';
  return kinds[0];
}

function summarizeProjectCost(options) {
  options = options || {};
  const runs = Array.isArray(options.runs) ? options.runs.slice(0, RUN_CAP) : [];
  const tasks = Array.isArray(options.tasks) ? options.tasks : [];
  const warnings = [];
  const skipped = { malformed_runs: 0 };

  const totals = {
    runs: 0,
    completed_runs: 0,
    failed_runs: 0,
    other_runs: 0,
    runs_with_usage: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cost_usd: 0
  };

  const breakdown = {
    reported: { runs: 0, cost_usd: 0, tokens: 0 },
    estimated: { runs: 0, cost_usd: 0, tokens: 0 },
    unknown: { runs: 0, cost_usd: 0, tokens: 0 }
  };

  let firstRunAt = null;
  let lastRunAt = null;

  runs.forEach(function (run) {
    if (!run || typeof run !== 'object') { skipped.malformed_runs += 1; return; }

    const inputTokens = numberOrNull(run.input_tokens);
    const outputTokens = numberOrNull(run.output_tokens);
    const cost = numberOrNull(run.estimated_cost_usd);
    const hasUsage = inputTokens !== null || outputTokens !== null || cost !== null;
    const provenance = normalizeProvenance(run.usage_source, hasUsage);

    totals.runs += 1;
    const status = String(run.status || '').toLowerCase();
    if (status === 'completed') totals.completed_runs += 1;
    else if (status === 'failed') totals.failed_runs += 1;
    else totals.other_runs += 1;

    if (run.created_at) {
      const stamp = String(run.created_at);
      if (!firstRunAt || stamp < firstRunAt) firstRunAt = stamp;
      if (!lastRunAt || stamp > lastRunAt) lastRunAt = stamp;
    }

    if (!hasUsage) return;
    totals.runs_with_usage += 1;
    totals.input_tokens += inputTokens || 0;
    totals.output_tokens += outputTokens || 0;
    totals.total_tokens += (inputTokens || 0) + (outputTokens || 0);
    totals.cost_usd += cost || 0;

    breakdown[provenance].runs += 1;
    breakdown[provenance].cost_usd += cost || 0;
    breakdown[provenance].tokens += (inputTokens || 0) + (outputTokens || 0);
  });

  const taskCounts = countTasks(tasks);
  const basis = dominantBasis(breakdown);

  // Cost per completed outcome: total recorded spend (including failed runs)
  // divided by tasks the operator actually marked done. Withheld when there is
  // no done task — a cost with no outcome is not a cost-per-outcome.
  let perOutcome = { cost_usd: null, tokens: null, basis: null, outcomes: taskCounts.done };
  if (taskCounts.done > 0) {
    perOutcome = {
      cost_usd: round4(totals.cost_usd / taskCounts.done),
      tokens: Math.round(totals.total_tokens / taskCounts.done),
      basis: basis,
      outcomes: taskCounts.done
    };
  }

  if (!totals.runs) {
    warnings.push({ code: 'no_runs', message: 'No agent runs recorded for this project yet.' });
  } else if (!totals.runs_with_usage) {
    warnings.push({ code: 'no_usage_recorded', message: 'Runs exist but none recorded token or cost usage; spend is unknown.' });
  }
  if (totals.runs_with_usage > 0 && breakdown.reported.runs === 0 && breakdown.estimated.runs > 0) {
    warnings.push({
      code: 'all_costs_estimated',
      message: 'Every cost figure here is a deterministic estimate from character counts, not harness-reported spend.'
    });
  }
  if (breakdown.unknown.runs > 0) {
    warnings.push({
      code: 'unlabeled_basis',
      message: breakdown.unknown.runs + ' run(s) predate usage-provenance capture; their token/cost basis is unknown.'
    });
  }
  if (totals.runs > 0 && taskCounts.done === 0) {
    warnings.push({
      code: 'no_completed_outcome',
      message: 'No task is marked done, so cost per completed outcome is unavailable.'
    });
  }
  if (Array.isArray(options.runs) && options.runs.length >= RUN_CAP) {
    warnings.push({
      code: 'truncated',
      message: 'Summary covers the newest ' + RUN_CAP + ' runs only; older spend is not included.'
    });
  }

  const costParts = [];
  if (breakdown.reported.runs) costParts.push(breakdown.reported.runs + ' harness-reported');
  if (breakdown.estimated.runs) costParts.push(breakdown.estimated.runs + ' estimated');
  if (breakdown.unknown.runs) costParts.push(breakdown.unknown.runs + ' unlabeled');
  const disclosure = totals.runs_with_usage
    ? 'Spend totals every recorded run, including failed attempts, and divides by tasks marked done. '
      + (costParts.length ? 'Basis: ' + costParts.join(' / ') + ' run(s).' : '')
    : 'No usage was recorded, so cost per outcome cannot be stated.';

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    window: { first_run_at: firstRunAt, last_run_at: lastRunAt },
    runs: {
      total: totals.runs,
      completed: totals.completed_runs,
      failed: totals.failed_runs,
      other: totals.other_runs,
      with_usage: totals.runs_with_usage,
      without_usage: totals.runs - totals.runs_with_usage
    },
    usage: {
      input_tokens: totals.input_tokens,
      output_tokens: totals.output_tokens,
      total_tokens: totals.total_tokens
    },
    cost: {
      total_usd: round4(totals.cost_usd),
      reported_usd: round4(breakdown.reported.cost_usd),
      estimated_usd: round4(breakdown.estimated.cost_usd),
      unknown_usd: round4(breakdown.unknown.cost_usd),
      reported_runs: breakdown.reported.runs,
      estimated_runs: breakdown.estimated.runs,
      unknown_runs: breakdown.unknown.runs
    },
    tasks: taskCounts,
    per_outcome: perOutcome,
    basis: basis,
    disclosure: disclosure,
    warnings: warnings,
    skipped: skipped
  };
}

module.exports = { summarizeProjectCost, RUN_CAP, PROVENANCE };
