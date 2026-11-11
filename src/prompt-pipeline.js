'use strict';

// Dispatch prompt pipeline.
//
// Visionary ships a large set of deterministic "nudge" modules, each derived
// from a Jake Van Clief lesson: continuity, cost, provenance, secret isolation,
// review gates, and so on. Historically server.js chained them like this:
//
//     augmenters.reduce((current, fn) => fn(current), message)
//
// That is a self-contaminating loop. Every nudge appends its block to the same
// string the next classifier reads, so block vocabulary ("media", "voice",
// "content", "artifact", "approval") re-triggers unrelated nudges. Measured on
// a 30-character request ("Fix the login bug in server.js") the chain injected
// 41 blocks and grew the prompt to ~49k characters (~12k tokens).
//
// Jake's prompt-and-memory-hierarchy lesson is the fix: separate instructions
// from evidence. The operator's message is the evidence; a nudge block is an
// instruction. Instructions must never be fed back into the classifier that
// decides whether another instruction applies.
//
// So this module does three things, deterministically:
//   1. classify every nudge against the operator's ORIGINAL message only;
//   2. rank the matches by the classifier's own signal score;
//   3. cap the injected context (count + characters) so the operator's task
//      stays the largest thing in the prompt, and report exactly what was
//      injected and what was dropped.

const path = require('node:path');

// Every dispatch-nudge module in src/. Kept explicit so a new module has to be
// registered deliberately; the loader derives the classify/block export names
// from the module itself and fails loudly if the shape is wrong.
const NUDGE_MODULES = [
  'agent-split',
  'ai-as-compiler-pipeline',
  'ai-workflow-ladder',
  'artifact-workbench',
  'asset-workbench',
  'augment-over-automate',
  'augmentation-means',
  'automation-timing',
  'baseline-ratchet',
  'capability-assumption-review',
  'challenge-design',
  'classifier-gate',
  'coding-agent-loop',
  'collaborative-document-branch',
  'company-brain',
  'completion-manifest',
  'consent-disclosure',
  'context-boundary',
  'continuity-workbench',
  'cross-domain-adjacency',
  'decision-boundary',
  'domain-expert-source',
  'downstream-export',
  'durable-retrospective',
  'efficiency-vs-amplification',
  'execution-evidence-gate',
  'experiment-matrix',
  'failure-study-loop',
  'fan-out-partitionability',
  'folder-product-baseline',
  'hand-back-surface',
  'instruction-provenance',
  'intent-compiler-workbench',
  'intent-match-review',
  'interface-boundary-check',
  'interface-layer-selection',
  'learning-loop',
  'media-provenance',
  'opinion-standard',
  'opportunity-routing',
  'portable-instruction-asset',
  'position-addressed-memory',
  'program-decomposition',
  'question-discovery',
  'repeated-problem-signal-mining',
  'replicability-check',
  'review-debt',
  'runtime-reach-portability',
  'scoped-memory-routing',
  'secret-isolation-review',
  'source-map-before-search',
  'source-provenance',
  'source-runtime-value',
  'spec-before-the-machine',
  'stage-gated-workbench',
  'system-decomposition',
  'tacit-capture',
  'value-layer',
  'vibe-coded-audit',
  'voice-file-check',
  'workbench-outcome-review',
  'workbench-prerequisite-gate',
  'workbench-sync-plane',
  'workflow-capture',
  'workflow-map',
  'workflow-resilience',
  'workflow-skill-template'
];

const DEFAULT_BUDGET_CHARS = 6000;
const DEFAULT_MAX_NUDGES = 4;

function loadRegistry() {
  const registry = [];
  for (const slug of NUDGE_MODULES) {
    const mod = require(path.join(__dirname, slug));
    const classifyKey = Object.keys(mod).find(function (k) { return /^classify/.test(k); });
    const blockKey = Object.keys(mod).find(function (k) { return /PromptBlock$/.test(k); });
    if (!classifyKey || !blockKey) {
      throw new Error('[prompt-pipeline] ' + slug + ' must export classify* and *PromptBlock');
    }
    registry.push({
      id: slug,
      classify: mod[classifyKey],
      block: mod[blockKey]
    });
  }
  return registry;
}

let cachedRegistry = null;
function getRegistry() {
  if (!cachedRegistry) cachedRegistry = loadRegistry();
  return cachedRegistry;
}

function toInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

// Budget resolution. 0 disables the cap (useful for debugging prompt content),
// any positive value is a hard ceiling on injected nudge characters.
function resolveLimits(env) {
  const source = env || process.env;
  const budget = source.VISIONARY_NUDGE_BUDGET_CHARS === undefined
    ? DEFAULT_BUDGET_CHARS
    : Math.max(0, toInt(source.VISIONARY_NUDGE_BUDGET_CHARS, DEFAULT_BUDGET_CHARS));
  const maxNudges = source.VISIONARY_NUDGE_MAX === undefined
    ? DEFAULT_MAX_NUDGES
    : Math.max(0, toInt(source.VISIONARY_NUDGE_MAX, DEFAULT_MAX_NUDGES));
  return { budget_chars: budget, max_nudges: maxNudges };
}

// Classify every nudge against the original message. Never against augmented
// text. Returns the full candidate list with deterministic ranking.
function evaluateNudges(message, opts) {
  const options = opts || {};
  const registry = options.registry || getRegistry();
  const original = String(message || '');
  const candidates = [];
  const errors = [];

  for (const entry of registry) {
    let classification;
    try {
      classification = entry.classify(original);
    } catch (err) {
      errors.push({ id: entry.id, error: (err && err.message) || String(err) });
      continue;
    }
    if (!classification || classification.applies !== true) continue;
    let block = '';
    try {
      block = String(entry.block(original) || '');
    } catch (err) {
      errors.push({ id: entry.id, error: (err && err.message) || String(err) });
      continue;
    }
    if (!block.trim()) continue;
    candidates.push({
      id: entry.id,
      score: Number.isFinite(classification.score) ? classification.score : 1,
      layer: classification.layer || null,
      reason: classification.reason || null,
      chars: block.length,
      block
    });
  }

  // Highest signal first; module id breaks ties so ordering is reproducible.
  candidates.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
  });

  return { candidates, errors };
}

// Build the final prompt plan: which nudges fit, which were dropped, and how
// much context the operator's request is competing with.
function planNudges(message, opts) {
  const options = opts || {};
  const limits = options.limits || resolveLimits(options.env);
  const original = String(message || '');
  const evaluated = options.evaluated || evaluateNudges(original, options);
  const applied = [];
  const dropped = [];
  let used = 0;

  for (const candidate of evaluated.candidates) {
    if (limits.max_nudges > 0 && applied.length >= limits.max_nudges) {
      dropped.push({ id: candidate.id, score: candidate.score, chars: candidate.chars, reason: 'max-nudges' });
      continue;
    }
    // Hard budget. If nothing has been applied yet, take the strongest signal
    // even when it alone exceeds the budget: an empty dispatch is worse than a
    // slightly over-budget one.
    if (limits.budget_chars > 0 && applied.length > 0 && used + candidate.chars > limits.budget_chars) {
      dropped.push({ id: candidate.id, score: candidate.score, chars: candidate.chars, reason: 'budget' });
      continue;
    }
    applied.push(candidate);
    used += candidate.chars;
  }

  const text = applied.length
    ? original + '\n\n' + applied.map(function (c) { return c.block; }).join('\n\n')
    : original;

  const meta = {
    original_chars: original.length,
    nudge_chars: used,
    prompt_chars: text.length,
    budget_chars: limits.budget_chars,
    max_nudges: limits.max_nudges,
    applied: applied.map(function (c) { return { id: c.id, score: c.score, chars: c.chars }; }),
    dropped: dropped.map(function (c) { return { id: c.id, score: c.score, chars: c.chars, reason: c.reason }; }),
    errors: evaluated.errors
  };

  return { text, meta };
}

function buildNudgedMessage(message, opts) {
  return planNudges(message, opts);
}

module.exports = {
  NUDGE_MODULES,
  DEFAULT_BUDGET_CHARS,
  DEFAULT_MAX_NUDGES,
  getRegistry,
  resolveLimits,
  evaluateNudges,
  planNudges,
  buildNudgedMessage
};
