// Cleanup service — periodic prune of growing tables.
//
// Adapted from odysseus's cleanup_service pattern. Visionary's audit tables
// (agent_messages, agent_health_log, activity_log) grow without bound. This
// module gives a single entry point to prune everything to safe retention.
//
// Defaults are conservative: 30 days for conversation, 14 days for health
// pings, 90 days for activity log, 90 days for finished agent runs.

const DEFAULTS = {
  agent_messages_days: 30,
  agent_health_log_days: 14,
  activity_log_days: 90,
  agent_runs_days: 90
};

function runPrune(stmts, opts) {
  opts = Object.assign({}, DEFAULTS, opts || {});
  const before = stmts.pruneAgentMessages.run('-' + opts.agent_messages_days + ' days');
  const health = stmts.pruneHealthLog.run('-' + opts.agent_health_log_days + ' days');
  const activity = stmts.pruneActivityLog.run('-' + opts.activity_log_days + ' days');
  const runs = stmts.pruneAgentRuns.run('-' + opts.agent_runs_days + ' days');
  return {
    pruned_at: new Date().toISOString(),
    agent_messages: before.changes,
    agent_health_log: health.changes,
    activity_log: activity.changes,
    agent_runs: runs.changes,
    retention_days: opts
  };
}

module.exports = { runPrune, DEFAULTS };
