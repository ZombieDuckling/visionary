'use strict';

// Deterministic classifier-gate nudge for repeated bounded judgments.
// Inspired by Jake Van Clief's decision-file pattern: labels, yes/no answers,
// scores, routing, and readiness checks should be explicit gates with thresholds,
// persistence, and human override loops — not hidden paragraph-generation calls.

const CLASSIFIER_TERMS = [
  'classifier', 'classify', 'classification', 'label', 'labels', 'tag', 'tags',
  'score', 'rating', 'rank', 'route', 'routing', 'triage', 'prioritize',
  'readiness', 'ready', 'approve', 'reject', 'yes/no', 'yes or no', 'pass/fail',
  'gate', 'gating', 'threshold', 'confidence'
];

const REPEAT_TERMS = [
  'batch', 'bulk', 'repeat', 'repeated', 'recurring', 'every', 'each', 'many',
  'queue', 'backlog', 'inbox', 'pipeline', 'workflow', 'intake', 'review',
  'manifest', 'dataset', 'items', 'records', 'leads', 'tickets'
];

const LLM_AUTOMATION_TERMS = [
  'llm', 'ai', 'agent', 'agents', 'model', 'automation', 'automate', 'prompt',
  'generate', 'decide', 'decision', 'evaluate', 'assessment', 'rubric'
];

const EXACT_FACT_TERMS = [
  'checksum', 'hash', 'sha256', 'sum', 'total', 'count', 'date calculation',
  'file exists', 'schema validation', 'json parse', 'syntax check', 'line count'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyClassifierGate(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const classifier = countMatches(text, CLASSIFIER_TERMS);
  const repeated = countMatches(text, REPEAT_TERMS);
  const automation = countMatches(text, LLM_AUTOMATION_TERMS);
  const exact = countMatches(text, EXACT_FACT_TERMS);
  const score = (classifier * 3) + (repeated * 2) + automation - (exact * 3);

  if (classifier === 0) {
    return { applies: false, reason: 'no bounded classifier/routing signal', score };
  }
  if (repeated === 0 && automation === 0) {
    return { applies: false, reason: 'one-off judgment without automation/repeat signal', score };
  }
  if (exact > 0 && classifier < 2) {
    return { applies: false, reason: 'looks like deterministic fact/check, not classifier gate', score };
  }
  if (score < 7) {
    return { applies: false, reason: 'weak classifier-gate signal', score };
  }

  const layer = text.indexOf('route') !== -1 || text.indexOf('routing') !== -1 || text.indexOf('triage') !== -1
    ? 'routing-gate'
    : text.indexOf('approve') !== -1 || text.indexOf('reject') !== -1 || text.indexOf('readiness') !== -1 || text.indexOf('ready') !== -1
      ? 'readiness-gate'
      : 'label-score-gate';

  return {
    applies: true,
    reason: 'repeated bounded judgment should be specified as an auditable decision file/classifier gate',
    score,
    layer,
    signals: { classifier, repeated, automation, exact }
  };
}

function classifierGatePromptBlock(message) {
  const classification = classifyClassifierGate(message);
  if (!classification.applies) return '';

  return '[CLASSIFIER-GATE CHECK]\n'
    + 'This looks like a repeated bounded judgment: label, yes/no, score, route, approval, readiness, or triage. Before using open-ended LLM output, define the gate as a small decision file or equivalent contract.\n'
    + '- Gate scope: name the input files/items, workflow stage, source-of-truth folder, and where results will be written.\n'
    + '- Allowed outputs: list the labels/yes-no/score range/route options, including `other` or `needs_human` if needed.\n'
    + '- Threshold policy: state confidence/readiness cutoffs for auto-act, flag-for-review, and stop-for-human.\n'
    + '- Deterministic exclusions: keep exact counts, dates, checksums, schema/syntax, and file-existence checks in code/tools, not language judgment.\n'
    + '- Override/eval loop: persist low-confidence cases and human overrides beside the source so future runs can be tested or tuned.\n'
    + 'Use a full LLM only for synthesis/generation after the bounded gate is explicit. Keep this proportional for small tasks.\n'
    + '[/CLASSIFIER-GATE CHECK]';
}

function appendClassifierGatePrompt(message) {
  const block = classifierGatePromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyClassifierGate,
  classifierGatePromptBlock,
  appendClassifierGatePrompt
};
