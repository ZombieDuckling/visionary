'use strict';

// Deterministic experiment/run-matrix nudge for evaluation and research dispatches.
// Inspired by Jake Van Clief's model-behavior pipeline lesson: serious AI
// comparisons need explicit variables, deterministic parsing/scoring, exports,
// and preserved failure data instead of anecdotal chat impressions.

const EVAL_TERMS = [
  'eval', 'evals', 'evaluation', 'evaluate', 'benchmark', 'compare', 'comparison',
  'test', 'experiment', 'research', 'study', 'measure', 'score', 'scoring',
  'assess', 'assessment', 'validate', 'validation', 'truth deck', 'quality gate'
];

const MATRIX_TERMS = [
  'model', 'models', 'provider', 'providers', 'runtime', 'harness', 'persona',
  'personas', 'role', 'roles', 'prompt', 'prompts', 'temperature', 'runs',
  'iterations', 'sample', 'samples', 'case', 'cases', 'scale', 'dataset', 'items'
];

const OUTPUT_TERMS = [
  'json', 'csv', 'export', 'exports', 'parse', 'parser', 'schema', 'metadata',
  'success rate', 'refusal', 'refusals', 'failure', 'failures', 'timeout',
  'timeouts', 'cost', 'latency', 'artifact', 'artifacts', 'provenance'
];

const BLIND_TEST_TERMS = [
  'best tool', 'best model', 'best provider', 'which tool', 'which model',
  'which provider', 'blind', 'blinded', 'anonymous', 'anonymize', 'anonymized',
  'a/b', 'ab test', 'a b test', 'side by side', 'same input', 'same prompt',
  'same case', 'leaderboard', 'leaderboards', 'subjective', 'taste', 'human pick',
  'pick before', 'answer key', 'candidate outputs', 'voice clone', 'design tool'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyExperimentMatrix(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const evalMatches = countMatches(text, EVAL_TERMS);
  const matrixMatches = countMatches(text, MATRIX_TERMS);
  const outputMatches = countMatches(text, OUTPUT_TERMS);
  const blindMatches = countMatches(text, BLIND_TEST_TERMS);
  const score = (evalMatches * 2) + matrixMatches + outputMatches + (blindMatches * 2);

  if (evalMatches === 0 && blindMatches === 0) {
    return { applies: false, reason: 'not evaluation/research shaped', score };
  }

  if (score < 5) {
    return { applies: false, reason: 'weak evaluation/research signal', score };
  }

  const layer = blindMatches >= 2
    ? 'blind-local-fit-test'
    : outputMatches >= 3
    ? 'auditable-experiment-pipeline'
    : matrixMatches >= 3
      ? 'explicit-run-matrix'
      : 'lightweight-evaluation';

  return {
    applies: true,
    reason: 'evaluation/research dispatch',
    score,
    layer,
    signals: {
      eval: evalMatches,
      matrix: matrixMatches,
      output: outputMatches,
      blind: blindMatches
    }
  };
}

function experimentMatrixPromptBlock(message) {
  const classification = classifyExperimentMatrix(message);
  if (!classification.applies) return '';

  return '[EXPERIMENT-MATRIX CHECK]\n'
    + 'Before judging model, prompt, persona, or workflow behavior, make the run shape explicit so the result is reproducible rather than anecdotal. Keep this proportional to the task.\n'
    + '- Variables: name the models/providers/runtimes, personas/roles, prompts/cases/items, temperature, run count, and any fixtures being compared.\n'
    + '- Output contract: define the JSON/CSV fields, schema, scoring rule, or truth-deck expectations before interpreting results.\n'
    + '- Deterministic parsing: use ordinary code for parsing, counting, scoring, and validation wherever possible; do not rely on vibes alone.\n'
    + '- Blind local fit: for subjective tool/model/provider choices, use the same input for every candidate, anonymize outputs as A/B/C, capture the human pick against local criteria before revealing brand, benchmark, or price, then record the answer key and tradeoffs.\n'
    + '- Failure data: preserve refusals, parse errors, timeouts, missing models, retries, cost, and latency as first-class outcomes.\n'
    + '- Evidence trail: save representative inputs, outputs, metadata, and artifacts privately so the operator can audit or rerun the experiment.\n'
    + 'If the request only needs a small spot-check, state that and use the smallest useful matrix.\n'
    + '[/EXPERIMENT-MATRIX CHECK]';
}

function appendExperimentMatrixPrompt(message) {
  const block = experimentMatrixPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyExperimentMatrix,
  experimentMatrixPromptBlock,
  appendExperimentMatrixPrompt
};
