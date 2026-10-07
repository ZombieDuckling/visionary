'use strict';

// Deterministic AI-workflow ladder nudge for requests that ask how to learn AI
// or turn real work into an AI workflow. Inspired by Jake Van Clief's learning
// ladder: promote work one rung at a time from chat proof -> reusable skill ->
// workbench files -> routing map -> staged artifacts -> deterministic scripts ->
// maintenance, instead of jumping straight to agent architecture.

const AI_TERMS = [
  'ai', 'llm', 'model', 'models', 'chatgpt', 'claude', 'gemini', 'agent', 'agents',
  'automation', 'automate', 'workflow', 'assistant', 'copilot'
];

const LEARNING_TERMS = [
  'learn', 'learning', 'study', 'teach', 'training', 'course', 'curriculum',
  'onboard', 'onboarding', 'upskill', 'from zero', 'beginner', 'master'
];

const BUILD_TERMS = [
  'build', 'create', 'make', 'design', 'turn', 'convert', 'productize', 'systemize',
  'implement', 'deploy', 'roll out', 'setup', 'set up', 'workflow', 'process'
];

const LADDER_FRAME_TERMS = [
  'current rung', 'rung', 'ladder', 'manual example', 'correction', 'corrections',
  'skill file', 'workbench', 'routing map', 'stage artifact', 'stage artifacts',
  'deterministic script', 'maintenance check', 'fresh session'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyAiWorkflowLadder(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const ai = countMatches(text, AI_TERMS);
  const learning = countMatches(text, LEARNING_TERMS);
  const build = countMatches(text, BUILD_TERMS);
  const ladderFrame = countMatches(text, LADDER_FRAME_TERMS);
  const score = (ai * 3) + (learning * 2) + (build * 2) - (ladderFrame * 3);

  if (ai === 0) {
    return { applies: false, reason: 'no AI/workflow signal', score };
  }
  if (learning === 0 && build === 0) {
    return { applies: false, reason: 'AI mention lacks learning or workflow-conversion intent', score };
  }
  if (ladderFrame >= 2) {
    return { applies: false, reason: 'operator already supplied ladder/promotion frame', score };
  }
  if (score < 7) {
    return { applies: false, reason: 'weak AI-workflow ladder signal', score };
  }

  const layer = learning >= 2
    ? 'ai-learning-path'
    : build >= 2
      ? 'workflow-promotion-path'
      : 'single-job-first';

  return {
    applies: true,
    reason: 'AI workflow requests should diagnose the current maturity rung before recommending tools or agents',
    score,
    layer,
    signals: { ai, learning, build, ladder_frame: ladderFrame }
  };
}

function aiWorkflowLadderPromptBlock(message) {
  const classification = classifyAiWorkflowLadder(message);
  if (!classification.applies) return '';

  return '[AI-WORKFLOW LADDER CHECK]\n'
    + 'This looks like an AI learning or workflow-conversion request. Diagnose the current rung before recommending tools, agents, or architecture.\n'
    + '- Real job first: name the actual job, user, input sources, next action, and failure mode.\n'
    + '- Current rung: identify whether this is chat proof, corrections/skill, workbench files, routing map, staged artifacts, deterministic script, or maintenance.\n'
    + '- Next promotion artifact: produce the smallest durable thing that moves one rung up — saved correction, skill/instruction, folder map, stage output, script, test, or maintenance note.\n'
    + '- Separation: keep reusable method apart from project/client facts and keep source material apart from generated outputs.\n'
    + '- Split discipline: default to one capable model reading the right files; add separate agents only for independent ownership, permissions, scale, watch duties, or review boundaries.\n'
    + '- Proof: name the fresh-session or next-operator check that proves the workflow survives beyond this chat.\n'
    + 'Do not overbuild; recommend the next rung, not the whole platform at once.\n'
    + '[/AI-WORKFLOW LADDER CHECK]';
}

function appendAiWorkflowLadderPrompt(message) {
  const block = aiWorkflowLadderPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyAiWorkflowLadder,
  aiWorkflowLadderPromptBlock,
  appendAiWorkflowLadderPrompt
};
