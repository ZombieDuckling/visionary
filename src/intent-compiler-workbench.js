'use strict';

// Deterministic intent-compiler nudge for folder/workbench requests where the
// valuable asset is the local mapping from human intent to machine action.
// Inspired by Jake Van Clief's "intent folders as compilers" lesson: keep the
// harness general, keep standards/examples/review rules local, and prove another
// capable runtime can follow the folder without hidden chat state.

const INTENT_TERMS = [
  'intent', 'intention', 'goal', 'outcome', 'job', 'jobs', 'operator', 'standard',
  'standards', 'taste', 'voice', 'rubric', 'review', 'criteria', 'examples'
];

const WORKBENCH_TERMS = [
  'folder', 'folders', 'workbench', 'workspace', 'repo', 'repository', 'files',
  'markdown', 'readme', 'claude.md', 'instructions', 'context', 'manifest',
  'source of truth', 'source-of-truth'
];

const COMPILER_TERMS = [
  'compiler', 'compile', 'compiles', 'portable', 'model-agnostic', 'model agnostic',
  'runtime', 'harness', 'agent', 'agents', 'workflow', 'automation', 'script',
  'scripts', 'tool', 'tools', 'connector', 'connectors'
];

const ACTION_TERMS = [
  'build', 'create', 'design', 'make', 'set up', 'setup', 'organize', 'codify',
  'package', 'standardize', 'convert', 'turn', 'map', 'document', 'ship'
];

const EXISTING_FRAME_TERMS = [
  '[intent-compiler workbench check]', 'intent compiler check', 'portable intent package',
  'root routing file', 'hidden chat state', 'vacation coverage'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyIntentCompilerWorkbench(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const existingFrame = countMatches(text, EXISTING_FRAME_TERMS);
  const intent = countMatches(text, INTENT_TERMS);
  const workbench = countMatches(text, WORKBENCH_TERMS);
  const compiler = countMatches(text, COMPILER_TERMS);
  const action = countMatches(text, ACTION_TERMS);
  const score = (intent * 2) + (workbench * 3) + (compiler * 2) + action;

  if (existingFrame >= 2) {
    return { applies: false, reason: 'operator already supplied intent-compiler frame', score };
  }
  if (workbench < 2) {
    return { applies: false, reason: 'no durable folder/workbench signal', score };
  }
  if (intent === 0 && compiler < 2) {
    return { applies: false, reason: 'no intent-to-runtime mapping signal', score };
  }
  if (action === 0 && score < 12) {
    return { applies: false, reason: 'descriptive mention, not a workbench build request', score };
  }
  if (score < 9) {
    return { applies: false, reason: 'weak intent-compiler signal', score };
  }

  const layer = compiler >= 3
    ? 'portable-intent-package'
    : intent >= 3
      ? 'local-standards-map'
      : 'folder-routing-map';

  return {
    applies: true,
    reason: 'folder/workbench work should preserve the local intent mapping before adding runtime behavior',
    score,
    layer,
    signals: { intent, workbench, compiler, action }
  };
}

function intentCompilerWorkbenchPromptBlock(message) {
  const classification = classifyIntentCompilerWorkbench(message);
  if (!classification.applies) return '';

  return '[INTENT-COMPILER WORKBENCH CHECK]\n'
    + 'This looks like a folder/workbench workflow where the durable asset is the readable mapping from human intent to machine action. Build or change the workbench so another capable runtime can compile the same intent without hidden chat state.\n'
    + '- Root routing file: name the README/CLAUDE/HANDOFF/manifest file that tells a fresh operator where to start.\n'
    + '- Local intent map: capture job goals, audience/people, standards/taste, examples/anti-examples, inputs, outputs, and review rules near the workflow.\n'
    + '- Harness boundary: keep the agent/runtime general; put workflow-specific instructions in files unless code, permissions, scheduling, connectors, or UI are truly required.\n'
    + '- Deterministic helpers: use scripts/checklists/classifier gates for exact checks and bounded decisions instead of asking the model to remember them.\n'
    + '- Portability proof: state how a second file-reading model or human substitute could run the folder, what would break without the original vendor/tool, and the smallest next artifact to fix that.\n'
    + 'Keep this practical: improve the intent package first, then add orchestration only for proven gaps.\n'
    + '[/INTENT-COMPILER WORKBENCH CHECK]';
}

function appendIntentCompilerWorkbenchPrompt(message) {
  const block = intentCompilerWorkbenchPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyIntentCompilerWorkbench,
  intentCompilerWorkbenchPromptBlock,
  appendIntentCompilerWorkbenchPrompt
};