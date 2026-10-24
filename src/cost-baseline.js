'use strict';

const crypto = require('node:crypto');

// Workflow cost baseline summarizer.
//
// Jake Van Clief's cost-baseline lesson: AI spend is only useful when compared
// to the real alternative — human search/build/review time, latency, and rework.
// This module keeps Visionary's first version deterministic and local: summarize
// stored run telemetry against an explicit operator-tunable human-time baseline.
//
// Extended with the whole-path / human-energy term (JirW3BgCQoU): the cost of an
// *outcome* (resolving a question) includes the human's screen-on search hours
// and interface effort, not just productive minutes or model tokens. Training is
// a one-time cost; serving/access for users is the larger ongoing cost, and the
// data-center burden is a hosting/centralization choice, not intrinsic to the
// model. This module therefore discloses the human search/interface term as a
// separate component of the whole-path baseline and reports a hosting/local-fit
// signal so repeated retrieval from a bounded corpus surfaces as a local-first
// candidate instead of an untracked hosted spend.

const DEFAULTS = {
  human_minutes_per_completed_run: 15,
  human_hourly_rate_usd: 75,
  human_search_minutes_per_completed_run: 8,
  window_label: 'last 30 days',
  large_context_token_threshold: 8000
};

// Heuristic markers for harnesses that run the model locally/self-hosted, so the
// hosting/energy externality lands on the operator's own hardware rather than a
// third-party server. Everything else with a known harness counts as hosted.
const LOCAL_HARNESS_MARKERS = ['ollama', 'local', 'lmstudio', 'mlx', 'llama', 'vllm', 'deepseek', 'dgx'];

function nonNegativeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function roundUsd(value) {
  return Math.round(nonNegativeNumber(value, 0) * 1000000) / 1000000;
}

function messageFingerprint(message) {
  const normalized = String(message || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function classifyHarness(harness) {
  const value = String(harness || '').trim().toLowerCase();
  if (!value) return 'unknown';
  return LOCAL_HARNESS_MARKERS.some(function (marker) { return value.indexOf(marker) !== -1; })
    ? 'local'
    : 'hosted';
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
  const searchMinutes = nonNegativeNumber(
    options.human_search_minutes_per_completed_run,
    DEFAULTS.human_search_minutes_per_completed_run
  );
  const searchRate = nonNegativeNumber(
    options.human_search_hourly_rate_usd,
    hourlyRate
  );
  const largeContextThreshold = nonNegativeNumber(
    options.large_context_token_threshold,
    DEFAULTS.large_context_token_threshold
  );

  let aiCost = 0;
  let completedRuns = 0;
  let estimatedCostRuns = 0;
  let tokenReportingRuns = 0;
  let localRuns = 0;
  let hostedRuns = 0;
  let unknownRuns = 0;
  const byAgent = new Map();
  const largeContextGroups = new Map();

  rows.forEach(function (row) {
    const status = String(row && row.status || '');
    const cost = nonNegativeNumber(row && row.estimated_cost_usd, 0);
    const agentId = String(row && row.agent_id || 'unassigned');

    aiCost += cost;
    if (status === 'completed') completedRuns += 1;
    if (cost > 0 && !(row.input_tokens || row.output_tokens)) estimatedCostRuns += 1;
    if (row.input_tokens != null || row.output_tokens != null) tokenReportingRuns += 1;

    const hosting = classifyHarness(row && (row.harness || row.runtime || row.runtime_id));
    if (hosting === 'local') localRuns += 1;
    else if (hosting === 'hosted') hostedRuns += 1;
    else unknownRuns += 1;

    const inputTokens = nonNegativeNumber(row && row.input_tokens, 0);
    const fingerprint = messageFingerprint(row && row.message);
    if (inputTokens >= largeContextThreshold) {
      const key = fingerprint || 'unknown:' + String(row && row.id || agentId || 'run');
      const group = largeContextGroups.get(key) || {
        fingerprint,
        runs: 0,
        input_tokens: 0,
        agent_ids: new Set()
      };
      group.runs += 1;
      group.input_tokens += inputTokens;
      group.agent_ids.add(agentId);
      largeContextGroups.set(key, group);
    }

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
  const largeContextSummary = Array.from(largeContextGroups.values());
  const repeatedContextGroups = largeContextSummary.filter(function (group) {
    return group.fingerprint && group.runs > 1;
  });
  const repeatedContextRuns = repeatedContextGroups.reduce(function (sum, group) {
    return sum + group.runs;
  }, 0);
  const largestRepeatedInputTokens = repeatedContextGroups.reduce(function (max, group) {
    return Math.max(max, group.input_tokens);
  }, 0);

  // Whole-path human term: screen-on search/interface effort that the answer
  // would otherwise cost the operator, disclosed separately from productive time.
  const searchHours = (completedRuns * searchMinutes) / 60;
  const humanSearchUsd = searchHours * searchRate;
  const humanPathCostUsd = humanBaseline + humanSearchUsd;
  const pathNetDelta = humanPathCostUsd - aiCost;

  const localFirstCandidate = repeatedContextRuns > 0;
  const hostingRecommendation = localFirstCandidate
    ? 'Repeated retrieval/synthesis from a bounded corpus dominates this window — a local model + local corpus is a viable local-first path that moves the hosting/energy externality onto your own hardware.'
    : (localRuns > 0
      ? 'Some runs already execute on local/self-hosted harnesses; keep bounded-corpus workloads there and reserve hosted models for broad synthesis.'
      : 'No repeated bounded-corpus pattern detected; hosting location is uncosted in this window — tag harnesses to make the externality visible.');

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
    whole_path_baseline: {
      assumptions: {
        human_search_minutes_per_completed_run: searchMinutes,
        human_search_hourly_rate_usd: searchRate
      },
      human_productive_usd: roundUsd(humanBaseline),
      human_search_usd: roundUsd(humanSearchUsd),
      human_path_cost_usd: roundUsd(humanPathCostUsd),
      ai_cost_usd: roundUsd(aiCost),
      path_net_delta_usd: roundUsd(pathNetDelta),
      decision_signal: completedRuns === 0
        ? 'no_completed_runs'
        : (pathNetDelta >= 0 ? 'ai_cheaper_than_whole_path' : 'ai_more_expensive_than_whole_path')
    },
    hosting_signal: {
      local_runs: localRuns,
      hosted_runs: hostedRuns,
      unknown_runs: unknownRuns,
      local_first_candidate: localFirstCandidate,
      recommendation: hostingRecommendation
    },
    telemetry_quality: {
      token_reporting_runs: tokenReportingRuns,
      estimated_cost_runs: estimatedCostRuns,
      missing_cost_runs: rows.filter(function (row) {
        return row && row.estimated_cost_usd == null;
      }).length
    },
    context_reread_risk: {
      large_context_token_threshold: largeContextThreshold,
      large_context_runs: largeContextSummary.reduce(function (sum, group) { return sum + group.runs; }, 0),
      repeated_context_groups: repeatedContextGroups.length,
      repeated_context_runs: repeatedContextRuns,
      largest_repeated_input_tokens: largestRepeatedInputTokens,
      recommendation: repeatedContextRuns > 0
        ? 'Distill repeated source/context once, then route future runs through the durable summary plus exact-source lookups.'
        : 'No repeated large-context prompt pattern detected in this window.'
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
