'use strict';

// Deterministic retrospective nudge for prompts that ask agents to revisit old
// plans, predictions, docs, roadmaps, or AI takes. Inspired by Jake Van Clief's
// durable-principle retrospective lesson: useful reviews separate primitives
// that still hold from tool/version tactics and market claims that changed.

const RETROSPECTIVE_TERMS = [
  'retrospective', 'retro', 'revisit', 'revisited', 'look back', 'postmortem',
  'after action', 'review old', 'old plan', 'old roadmap', 'old prediction',
  'predictions', 'forecast', 'take', 'takes', 'what held up', 'what changed',
  'still true', 'aged well', 'aged badly', 'update this', 'update the plan'
];

const TIME_TERMS = [
  '2023', '2024', '2025', '2026', 'last year', 'older', 'previous', 'prior',
  'past', 'history', 'historical', 'archive', 'old', 'outdated', 'current',
  'now', 'today', 'since then'
];

const AI_PRODUCT_TERMS = [
  'ai', 'agent', 'agents', 'automation', 'workflow', 'product', 'platform',
  'roadmap', 'strategy', 'tool', 'tools', 'model', 'models', 'prompt', 'prompts',
  'software', 'dashboard', 'feature', 'market'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyDurableRetrospective(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const retrospectiveMatches = countMatches(text, RETROSPECTIVE_TERMS);
  const timeMatches = countMatches(text, TIME_TERMS);
  const aiProductMatches = countMatches(text, AI_PRODUCT_TERMS);
  const score = (retrospectiveMatches * 4) + (timeMatches * 2) + aiProductMatches;

  if (retrospectiveMatches === 0) {
    return { applies: false, reason: 'no retrospective signal', score };
  }
  if (aiProductMatches === 0 && timeMatches < 2) {
    return { applies: false, reason: 'retrospective signal lacks product/time context', score };
  }
  if (score < 7) {
    return { applies: false, reason: 'retrospective signal too weak', score };
  }

  const layer = retrospectiveMatches >= 2 && timeMatches >= 2
    ? 'principle-ledger'
    : aiProductMatches >= 2
      ? 'strategy-refresh'
      : 'lightweight-retrospective';

  return {
    applies: true,
    reason: 'retrospective work should separate durable principles from stale tactics',
    score,
    layer,
    signals: {
      retrospective: retrospectiveMatches,
      time: timeMatches,
      ai_product: aiProductMatches
    }
  };
}

function durableRetrospectivePromptBlock(message) {
  const classification = classifyDurableRetrospective(message);
  if (!classification.applies) return '';

  return '[DURABLE-RETROSPECTIVE CHECK]\n'
    + 'This looks like a review of older plans, claims, strategy, docs, or AI/product work. Do not flatten it into a generic summary; separate what should persist from what should be retired.\n'
    + '- Original claim or plan: state the source, date/context if known, and what it was trying to solve.\n'
    + '- Held up: name the durable principle or primitive that still transfers across tools/models.\n'
    + '- Changed: name tool/version, market, workflow, or assumption shifts that make parts stale or incomplete.\n'
    + '- Decision: keep, revise, archive, or retest each major claim; do not silently rewrite history.\n'
    + '- Reusable structure: save durable findings as a checklist, ledger, source map, test case, or backlog item only when it helps future operators.\n'
    + 'Keep the requested deliverable first; use the retrospective to improve judgment, not to add ceremony.\n'
    + '[/DURABLE-RETROSPECTIVE CHECK]';
}

function appendDurableRetrospectivePrompt(message) {
  const block = durableRetrospectivePromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyDurableRetrospective,
  durableRetrospectivePromptBlock,
  appendDurableRetrospectivePrompt
};
