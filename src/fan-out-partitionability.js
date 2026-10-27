'use strict';

// Deterministic fan-out partitionability nudge for dispatches that parallelize
// work across agents, workers, people, or cron jobs. Inspired by Jake Van Clief's
// Brooks'-law lesson (video nnQcgv2rRhU, concept
// agent-parallelism-partitionability-review): parallelism increases progress only
// when the task can be partitioned into independent pieces with no communication
// between them. For coupled goals — where "best" is relative and the pieces must
// agree — adding agents/workers lengthens the path. Tokens/agents burned is spend,
// not progress.
//
// This gates the *fan-out decision* at dispatch time. It is distinct from
// agent-split (should we add a new role/agent at all?) and program-decomposition
// (decompose AI-as-worker into instructions/runner/state/hand-back). This fires
// when work is about to be split across multiple agents/workers in parallel and
// the partitionability of that work has not been established — the "we have
// agents, so let's swarm" failure mode.

const PARALLELISM_INTENT_TERMS = [
  'in parallel', 'parallel', 'parallelize', 'parallelise', 'parallelized',
  'parallelised', 'fan out', 'fan-out', 'fanout', 'concurrent', 'concurrently',
  'at the same time', 'simultaneously', 'simultaneous', 'swarm',
  'multiple agents', 'several agents', 'two agents', 'multiple workers',
  'several workers', 'multiple people', 'several people', 'multiple runs',
  'run agents in parallel', 'spawn agents', 'spawn multiple', 'burst',
  'divide among', 'divide across', 'split across', 'split among', 'shard',
  'sharding', 'scatter', 'broadcast to', 'orchestrate', 'orchestration',
  'dispatch to multiple', 'delegate to several', 'delegate across'
];

// Context that the thing being fanned out is actual work (a task, a codebase,
// research, a batch, etc.) rather than an incidental mention of "parallel".
const WORKLOAD_TERMS = [
  'task', 'tasks', 'work', 'job', 'jobs', 'request', 'requests', 'agent',
  'agents', 'worker', 'workers', 'people', 'team', 'teams', 'codebase',
  'files', 'file', 'repo', 'repository', 'research', 'scan', 'scans', 'audit',
  'review', 'reviews', 'queries', 'query', 'batch', 'backlog', 'tickets',
  'ticket', 'chunks', 'chunk', 'slices', 'slice', 'jobs across'
];

// If enough of these are already present, the operator/agent has already framed
// the partitionability question, so we should not nag.
const FRAMED_TERMS = [
  'independent', 'independently', 'partition', 'partitionable',
  'partitionability', 'seams', 'non-overlapping', 'nonoverlapping',
  'no shared', 'shared write', 'single-threaded', 'single threaded',
  'serialize', 'serialized', 'serialise', 'coordination', 'communication cost',
  'brooks', 'mythical man-month', 'mythical man month', 'decompose',
  'decomposition', 'verified slices', 'delivered slices', 'progress metric',
  'review pass', 'dependency', 'dependencies', 'dependency graph', 'dag',
  'ownership map', 'exclusive surface', 'coupled core'
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word-boundary matching so short tokens cannot false-match inside other words.
function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    const pattern = new RegExp('\\b' + escapeRegExp(term) + '\\b');
    return pattern.test(text) ? count + 1 : count;
  }, 0);
}

function classifyFanOutPartitionability(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const parallelism = countMatches(text, PARALLELISM_INTENT_TERMS);
  const workload = countMatches(text, WORKLOAD_TERMS);
  const framed = countMatches(text, FRAMED_TERMS);

  if (parallelism === 0) {
    return { applies: false, reason: 'no parallel/fan-out intent', score: 0 };
  }

  const score = (parallelism * 2) + workload;

  if (workload === 0) {
    return { applies: false, reason: 'parallel intent without a workload context', score };
  }
  if (framed >= 2) {
    return { applies: false, reason: 'partitionability already framed', score };
  }
  if (score < 3) {
    return { applies: false, reason: 'weak fan-out signal', score };
  }

  const layer = parallelism >= 2
    ? 'explicit-parallel-fan-out'
    : 'implied-fan-out';

  return {
    applies: true,
    reason: 'work is about to be fanned out; establish its partitionability first',
    score,
    layer,
    signals: { parallelism, workload, framed }
  };
}

function fanOutPartitionabilityPromptBlock(message) {
  const classification = classifyFanOutPartitionability(message);
  if (!classification.applies) return '';

  return '[FAN-OUT PARTITIONABILITY CHECK]\n'
    + 'This dispatch is about to split work across multiple agents/workers in parallel. Parallelism is licensed only for partitionable, communication-free work — for coupled goals, adding agents lengthens the path and burns tokens without progress. Before fanning out, establish partitionability. Keep this brief and then continue the task.\n'
    + '- Independent units: state whether the task splits into pieces that can each be produced without reading or negotiating with another piece. If not, parallelism is not licensed.\n'
    + '- Ownership map: give each worker an exclusive file/artifact/decision surface. A shared write target forces serialization.\n'
    + '- Coordination edges: list any coordination the workers must do mid-task. Every required coordination edge is a partition failure; the target is zero.\n'
    + '- Coupled core: name what must stay single-threaded (architecture, whole-artifact edits, one cohesive document) and run it with one worker plus a separate review pass.\n'
    + '- Review is not a slice: verification of coupled work is an independent pass, not another competing writer.\n'
    + '- Progress metric: report delivered, verified slices — not agent counts or tokens burned. Spend is not progress.\n'
    + '- Placement before automation: decide where the pieces live (folders, owners, state) before automating them; decomposition precedes automation.\n'
    + '- Verdict: parallelize with non-overlapping ownership / serialize the coupled core to one worker + review / split out the independent slices and run the coupled core single-threaded.\n'
    + '[/FAN-OUT PARTITIONABILITY CHECK]';
}

function appendFanOutPartitionabilityPrompt(message) {
  const block = fanOutPartitionabilityPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyFanOutPartitionability,
  fanOutPartitionabilityPromptBlock,
  appendFanOutPartitionabilityPrompt
};
