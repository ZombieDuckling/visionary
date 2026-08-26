'use strict';

// Workflow cost baseline summarizer.
//
// Jake Van Clief's cost-baseline lesson: AI spend is only useful when compared
// to the real alternative — human search/build/review time, latency, and rework.
// This module keeps Visionary's first version deterministic and local: summarize
// stored run telemetry against an explicit operator-tunable human-time baseline.

const DEFAULTS = {
  human_minutes_per_completed_run: 15,
  human_hourly_rate_usd: 75,
  window_label: 'last 30 days'
};

function nonNegativeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function roundUsd(value) {
  return Math.round(nonNegativeNumber(value, 0) * 1000000) / 1000000;
}

function summarizeCostBaseline(rows, options) {
  rows = Array.isArray(rows) ? rows : [];
  options = Object.assign({}, DEFAULTS, options || {});

  const humanMinutes = nonNegativeNumber(
    options.human_minutes_per_completed_run,
    DEFAULTS.human_minutes_per_completed_run
  );
  const hourlyRate = nonNegativeNumber(
    options.human_hourly_rate_usd,
    DEFAULTS.human_hourly_rate_usd
  );

  let aiCost = 0;
  let completedRuns = 0;
  let estimatedCostRuns = 0;
  let tokenReportingRuns = 0;
  const byAgent = new Map();

  rows.forEach(function (row) {
    const status = String(row && row.status || '');
    const cost = nonNegativeNumber(row && row.estimated_cost_usd, 0);
    const agentId = String(row && row.agent_id || 'unassigned');

    aiCost += cost;
    if (status === 'completed') completedRuns += 1;
    if (cost > 0 && !(row.input_tokens || row.output_tokens)) estimatedCostRuns += 1;
    if (row.input_tokens != null || row.output_tokens != null) tokenReportingRuns += 1;

    const current = byAgent.get(agentId) || {
      agent_id: agentId,
      runs: 0,
      completed_runs: 0,
      ai_cost_usd: 0
    };
    current.runs += 1;
    if (status === 'completed') current.completed_runs += 1;
    current.ai_cost_usd += cost;
    byAgent.set(agentId, current);
  });

  const baselineHours = (completedRuns * humanMinutes) / 60;
  const humanBaseline = baselineHours * hourlyRate;
  const netDelta = humanBaseline - aiCost;
  const costPerCompletedRun = completedRuns ? aiCost / completedRuns : 0;

  return {
    window_label: String(options.window_label || DEFAULTS.window_label),
    total_runs: rows.length,
    completed_runs: completedRuns,
    ai_cost_usd: roundUsd(aiCost),
    human_baseline_usd: roundUsd(humanBaseline),
    net_delta_usd: roundUsd(netDelta),
    cost_per_completed_run_usd: roundUsd(costPerCompletedRun),
    baseline_assumptions: {
      human_minutes_per_completed_run: humanMinutes,
      human_hourly_rate_usd: hourlyRate
    },
    telemetry_quality: {
      token_reporting_runs: tokenReportingRuns,
      estimated_cost_runs: estimatedCostRuns,
      missing_cost_runs: rows.filter(function (row) {
        return row && row.estimated_cost_usd == null;
      }).length
    },
    by_agent: Array.from(byAgent.values())
      .map(function (agent) {
        return Object.assign({}, agent, { ai_cost_usd: roundUsd(agent.ai_cost_usd) });
      })
      .sort(function (a, b) { return b.ai_cost_usd - a.ai_cost_usd || b.runs - a.runs; })
      .slice(0, 8),
    decision_signal: completedRuns === 0
      ? 'no_completed_runs'
      : (netDelta >= 0 ? 'ai_cheaper_than_baseline' : 'ai_more_expensive_than_baseline')
  };
}

module.exports = {
  DEFAULTS,
  summarizeCostBaseline
};
