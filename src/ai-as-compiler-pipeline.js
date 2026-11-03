'use strict';

// Deterministic AI-as-compiler pipeline nudge for requests that repeat an AI
// generation workflow and need the result to be reproducible and verifiable.
// Inspired by Jake Van Clief's "AI is the new compiler" lesson (videos
// RZ0AcCLVPFA "AI is the New Compiler (Why 'Learning AI' is the Wrong Goal)"
// and jjV1ckgPzI0 "I Charged $2000 For This AI Lecture (And I Underpriced It)"):
// the practical unit is not a magic prompt but a small compilation pipeline —
// a fixed instruction template, variable source data, a role/persona/context
// slot, an output structure/schema, validation/checks, an error/retry policy,
// and a stored result with source links. The failure it prevents is teams
// saying "we need AI" and then building opaque prompt chains without stating
// what is fixed, what varies, what validates output, or where the result
// becomes durable state.
//
// This is the *repeatable-compilation* layer. Distinct from
// intent-compiler-workbench (fires on folder/workbench buildout and portable
// intent packages), program-decomposition (fires when a dispatch frames AI as
// the whole program), classifier-gate (bounded repeated judgment), and
// execution-evidence-gate (trusting a "running/successful" status). This nudge
// fires specifically when a repeated AI generation workflow needs its fixed /
// variable / schema / validation / durable-output parts named.

const REPEAT_TERMS = [
  'pipeline', 'pipelines', 'repeatable', 'repeat', 'repeated', 'repetition',
  'recurring', 'recurrence', 'batch', 'batches', 'bulk', 'at scale',
  'template', 'templated', 'template-driven', 'prompt chain', 'prompt chains',
  'prompt pipeline', 'prompt template', 'workflow chain', 'compile', 'compiler'
];

const GENERATION_TERMS = [
  'generate', 'generates', 'generated', 'generation', 'produce', 'produces',
  'produced', 'draft', 'drafts', 'write', 'writes', 'summary', 'summaries',
  'output', 'outputs', 'llm', 'llms', 'model', 'models', 'agent', 'agents',
  'prompt', 'prompts', 'ai'
];

const VARIABLE_TERMS = [
  'variable', 'variables', 'varies', 'per client', 'per customer', 'per lead',
  'per account', 'per record', 'per row', 'per item', 'each client',
  'each customer', 'each lead', 'each record', 'each row', 'each item',
  'for each', 'for every', 'input data', 'source data', 'dataset', 'datasets',
  'csv', 'spreadsheet', 'rows', 'records', 'manifest'
];

const STRUCTURE_TERMS = [
  'schema', 'structured', 'json', 'csv', 'format', 'formatted', 'fields',
  'sections', 'parse', 'parseable', 'downstream', 'extract', 'table'
];

const VALIDATION_TERMS = [
  'validate', 'validation', 'verify', 'verification', 'check', 'checks', 'qa',
  'quality', 'review', 'threshold', 'confidence', 'eval', 'evaluate', 'test',
  'tests'
];

const ACTION_TERMS = [
  'build', 'create', 'design', 'make', 'set up', 'setup', 'wire', 'ship',
  'turn', 'convert', 'automate', 'refactor', 'standardize', 'package',
  'produce', 'generate', 'run'
];

const EXISTING_FRAME_TERMS = [
  '[ai-as-compiler pipeline check]', 'compiler map', 'fixed instruction',
  'variable inputs', 'output schema', 'compilation pipeline', 'ai as compiler',
  'ai-as-compiler'
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-word matching so short terms such as "ai", "json", "csv", and "qa"
// cannot false-match inside longer words.
function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    const pattern = new RegExp('\\b' + escapeRegExp(term) + '\\b');
    return pattern.test(text) ? count + 1 : count;
  }, 0);
}

function classifyAiAsCompilerPipeline(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const existingFrame = countMatches(text, EXISTING_FRAME_TERMS);
  const repeat = countMatches(text, REPEAT_TERMS);
  const generation = countMatches(text, GENERATION_TERMS);
  const variable = countMatches(text, VARIABLE_TERMS);
  const structure = countMatches(text, STRUCTURE_TERMS);
  const validation = countMatches(text, VALIDATION_TERMS);
  const action = countMatches(text, ACTION_TERMS);
  const score = (repeat * 2) + (generation * 2) + (variable * 2) + structure + validation;

  if (existingFrame >= 2) {
    return { applies: false, reason: 'operator already supplied a compiler-map frame', score };
  }
  // Must be a repeated AI generation workflow, not a one-off task.
  if (repeat < 1 || generation < 1) {
    return { applies: false, reason: 'no repeated AI generation signal', score };
  }
  // And it must expose some compilation surface (variable data, structure,
  // or validation) — otherwise it is just a vague "pipeline" mention.
  if (variable === 0 && structure === 0 && validation === 0) {
    return { applies: false, reason: 'no variable-data, schema, or validation surface', score };
  }
  if (action === 0 && score < 12) {
    return { applies: false, reason: 'descriptive mention, not a build/repeat request', score };
  }
  if (score < 8) {
    return { applies: false, reason: 'weak ai-as-compiler signal', score };
  }

  const layer = structure >= 1
    ? 'structured-output-pipeline'
    : variable >= 1
      ? 'variable-data-compilation'
      : 'repeat-workflow-compilation';

  return {
    applies: true,
    reason: 'a repeated AI generation workflow should be designed as a small compilation pipeline with fixed/variable parts, structure, validation, and durable output named before it is trusted',
    score,
    layer,
    signals: { repeat, generation, variable, structure, validation, action }
  };
}

function aiAsCompilerPipelinePromptBlock(message) {
  const classification = classifyAiAsCompilerPipeline(message);
  if (!classification.applies) return '';

  return '[AI-AS-COMPILER PIPELINE CHECK]\n'
    + 'This looks like a repeated AI workflow that turns intent and source data into output at scale. Treat it as a small compilation pipeline, not a magic prompt. Before building or automating, answer these:\n'
    + '- Compiler map: name each part explicitly — fixed instruction; variable inputs/source files; role/persona/context slot; output schema/format; validation checks; retry/error policy; stored result path; and human review threshold.\n'
    + '- Fixed vs variable: separate the fixed prompt text from the task/client/source data that changes, and keep the variable data in files/tables/JSON/manifests when the run must repeat.\n'
    + '- Structured output: prefer a schema downstream systems can parse or compare instead of free prose, and say who or what consumes it.\n'
    + '- Compilation environment: record model/provider/parameters/context so a rerun or model swap reproduces the result rather than silently drifting.\n'
    + '- Validation before trust: parse the schema, check source citations, diff/test, or set a confidence threshold plus human review before the generated output is treated as correct.\n'
    + '- Escalation rule: stay in chat until copy/paste repeats or evaluation matters, then promote the map to a skill/script/agent — do not jump straight to a framework.\n'
    + '- Verdict: a reproducible compilation pipeline (name fixed/variable/validation/durable output) versus a one-off prompt that will not repeat or verify.\n'
    + '[/AI-AS-COMPILER PIPELINE CHECK]';
}

function appendAiAsCompilerPipelinePrompt(message) {
  const block = aiAsCompilerPipelinePromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyAiAsCompilerPipeline,
  aiAsCompilerPipelinePromptBlock,
  appendAiAsCompilerPipelinePrompt
};
