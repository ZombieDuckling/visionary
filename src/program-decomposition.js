'use strict';

// Deterministic program-decomposition nudge for dispatches that frame AI as the
// worker — "AI can do the work", "let AI handle it", "have AI do X", "now that
// AI can...". Inspired by Jake Van Clief's program-decomposition lesson (video
// H2bYz5kIYk4, concept ai-is-part-of-a-program): a program is instructions + a
// runner + surviving output/state, and AI occupies only the *runner* slot. The
// failure mode is treating the model as the whole program — leaving the why,
// the durable state, the verification, and the human hand-back unnamed.
//
// This is distinct from the system-decomposition nudge (which names production
// layers for AI-system/protocol builds) and the augment-over-automate nudge
// (which challenges robot-mode automation claims). This nudge fires on
// *AI-as-worker framing*: the operator is about to let a model carry the work
// without saying where the instructions/why live, what survives the run, or
// where the human gets handed back to.

const AI_WORKER_TERMS = [
  'ai can do', 'ai can handle', 'ai does the work', 'ai will do', 'ai does it',
  'let ai', 'have ai', 'ai handle', 'ai takes over', 'ai handles',
  'ai runs it', 'ai generates', 'ai writes it', 'ai builds',
  'delegate to ai', 'hand it to ai', 'hand this to ai', 'ai-powered',
  'ai powered', 'now that ai', 'with ai doing', 'the model does', 'model will do',
  'agent does the work', 'let the agent do'
];

const WORK_TERMS = [
  'build', 'make', 'create', 'write', 'generate', 'ship', 'deliver', 'run',
  'workflow', 'process', 'automate', 'automation', 'product', 'offer',
  'service', 'scale', 'replace', 'outsource', 'delegate', 'handle', 'handle the',
  'take the work'
];

const NAMED_DECOMPOSITION_TERMS = [
  'instructions', 'instruction', 'runner', 'surviving state', 'survives the run',
  'surviving output', 'hand-back', 'hand back', 'handback', 'human hand',
  'human in the loop', 'human-in-the-loop', 'embed the why', 'owns the why',
  'where the why'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyProgramDecomposition(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const aiWorker = countMatches(text, AI_WORKER_TERMS);
  const work = countMatches(text, WORK_TERMS);
  const named = countMatches(text, NAMED_DECOMPOSITION_TERMS);

  if (aiWorker === 0) {
    return { applies: false, reason: 'not AI-as-worker framing', score: work };
  }
  if (named >= 1) {
    return { applies: false, reason: 'decomposition already named', score: aiWorker + work };
  }
  if (aiWorker + work < 2) {
    return { applies: false, reason: 'weak AI-as-worker signal', score: aiWorker + work };
  }

  const layer = aiWorker >= 2
    ? 'explicit-ai-as-worker'
    : 'implied-ai-as-worker';

  return {
    applies: true,
    reason: 'AI framed as the worker; name instructions, runner, surviving state, and the human hand-back before accepting it',
    score: aiWorker + work,
    layer,
    signals: { ai_worker: aiWorker, work: work, named: named }
  };
}

function programDecompositionPromptBlock(message) {
  const classification = classifyProgramDecomposition(message);
  if (!classification.applies) return '';

  return '[PROGRAM-DECOMPOSITION CHECK]\n'
    + 'This request leans on AI to carry the work. A program is instructions + a runner + surviving state; the model only fills the runner slot. Before accepting the plan, label each part briefly:\n'
    + '- Instructions: where does the why (intent, opinion, judgment) live, and can the runner actually see it in the right order and place? When authoring a prompt or context file, decompose the instruction sentence into goal, constraint, assumption, and entity, and reconcile the assumptions the model hands back into the file instead of leaving them implicit.\n'
    + '- Runner: name the model/runtime that executes the instructions, kept separate from them — never let the model own the whole program.\n'
    + '- Surviving state: what durable output or memory survives the run, and who can inspect it afterwards.\n'
    + '- Human hand-back: where the automation returns to a person for intent, judgment, and accountability. That point is the efficiency moat, not an optional nicety — never leave it as "none".\n'
    + '- Ownership split: take non-opinionated parts (connectors, runtimes, tooling) from whoever does them best; encode the opinionated why yourself rather than inheriting someone else\'s prompt, skill, or weights.\n'
    + '- Verify: all four parts named, and the hand-back point is a real person/checkpoint rather than a bare "AI does it".\n'
    + '[/PROGRAM-DECOMPOSITION CHECK]';
}

function appendProgramDecompositionPrompt(message) {
  const block = programDecompositionPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyProgramDecomposition,
  programDecompositionPromptBlock,
  appendProgramDecompositionPrompt
};
