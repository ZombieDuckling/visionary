'use strict';

// Deterministic question-discovery nudge for underdefined diagnosis/intake work.
// Inspired by Jake Van Clief's "better questions" lesson: when answers are
// abundant, the agent should extract the right question, constraints, unknowns,
// sources, and success criteria before executing the wrong task quickly.

const DISCOVERY_TERMS = [
  'discover', 'discovery', 'diagnose', 'diagnosis', 'intake', 'interview',
  'question', 'questions', 'ask', 'clarify', 'clarification', 'understand',
  'extract', 'scope', 'scoping', 'brief', 'requirements', 'requirements gathering'
];

const UNDERDEFINED_TERMS = [
  'help me', 'figure out', 'work out', 'not sure', 'unclear', 'ambiguous',
  'open ended', 'open-ended', 'explore', 'investigate', 'evaluate', 'assess',
  'what should', 'how should', 'find out', 'make sense of', 'shape', 'refine'
];

const DOMAIN_TERMS = [
  'client', 'customer', 'user', 'users', 'stakeholder', 'stakeholders', 'market',
  'product', 'workflow', 'process', 'business', 'team', 'role', 'agent', 'automation',
  'app', 'platform', 'dashboard', 'feature', 'offer', 'service', 'problem', 'pain'
];

const EXECUTION_TERMS = [
  'build', 'create', 'write', 'draft', 'generate', 'implement', 'automate',
  'design', 'plan', 'strategy', 'proposal', 'spec', 'roadmap', 'recommend'
];

const ANSWER_BAR_TERMS = [
  'constraints', 'success criteria', 'acceptance criteria', 'source material',
  'sources', 'stakeholders', 'non-goals', 'unknowns', 'assumptions', 'edge cases',
  'rubric', 'must include', 'must avoid', 'definition of done', 'examples'
];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    const pattern = new RegExp('(^|[^a-z0-9])' + escapeRegExp(term) + '($|[^a-z0-9])', 'i');
    return pattern.test(text) ? count + 1 : count;
  }, 0);
}

function classifyQuestionDiscovery(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const discovery = countMatches(text, DISCOVERY_TERMS);
  const underdefined = countMatches(text, UNDERDEFINED_TERMS);
  const domain = countMatches(text, DOMAIN_TERMS);
  const execution = countMatches(text, EXECUTION_TERMS);
  const answerBar = countMatches(text, ANSWER_BAR_TERMS);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const shortPrompt = wordCount <= 28;
  const score = (discovery * 3) + (underdefined * 2) + domain + execution + (shortPrompt ? 1 : 0) - (answerBar * 2);

  if (answerBar >= 3) {
    return { applies: false, reason: 'operator already supplied discovery frame', score };
  }
  if (discovery === 0 && underdefined === 0) {
    return { applies: false, reason: 'no discovery signal', score };
  }
  if (domain === 0 && execution === 0) {
    return { applies: false, reason: 'not a workflow/product/client task', score };
  }
  if (score < 5) {
    return { applies: false, reason: 'specific enough for direct execution', score };
  }

  const layer = underdefined >= 2 || (discovery >= 2 && execution < 2)
    ? 'question-first-discovery'
    : execution >= 2
      ? 'pre-execution-framing'
      : 'lightweight-intake';

  return {
    applies: true,
    reason: 'underdefined work should extract the right question before execution',
    score,
    layer,
    signals: {
      discovery,
      underdefined,
      domain,
      execution,
      answer_bar: answerBar,
      word_count: wordCount
    }
  };
}

function questionDiscoveryPromptBlock(message) {
  const classification = classifyQuestionDiscovery(message);
  if (!classification.applies) return '';

  return '[QUESTION-DISCOVERY CHECK]\n'
    + 'This looks underdefined enough that fast execution may answer the wrong question. Before delivering, extract the better question and then proceed with stated assumptions.\n'
    + '- Better question: rewrite the task as the sharpest answerable question or decision the operator likely needs.\n'
    + '- Known facts and sources: name the provided facts, files, records, users, or artifacts you are relying on.\n'
    + '- Unknowns and constraints: list the smallest set of missing details, constraints, stakeholders, and success criteria that change the answer.\n'
    + '- Execution frame: state assumptions, non-goals, and the first bounded action or artifact to produce now.\n'
    + '- Verification: explain how the result can be checked against the extracted question rather than generic completion.\n'
    + 'Do not stall waiting for clarification unless the task is unsafe or impossible; ask better questions by making the work inspectable.\n'
    + '[/QUESTION-DISCOVERY CHECK]';
}

function appendQuestionDiscoveryPrompt(message) {
  const block = questionDiscoveryPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyQuestionDiscovery,
  questionDiscoveryPromptBlock,
  appendQuestionDiscoveryPrompt
};
