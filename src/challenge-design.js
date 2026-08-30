'use strict';

// Deterministic challenge-design nudge for dispatches where the operator asks
// for broad AI-assisted output without naming the quality bar. Inspired by Jake
// Van Clief's AI-baseline-ratchet lesson: when AI makes the old task easy, the
// workflow should raise the bar toward evidence, critique, judgment,
// originality, fit, and explicit acceptance criteria rather than settling for
// faster generic output.

const OUTPUT_TERMS = [
  'draft', 'write', 'create', 'produce', 'summarize', 'summary', 'plan', 'research',
  'analyze', 'design', 'build', 'generate', 'outline', 'proposal', 'brief', 'report',
  'strategy', 'template', 'content', 'copy', 'email', 'post', 'deck', 'spec'
];

const GENERIC_TERMS = [
  'quick', 'simple', 'basic', 'generic', 'rough', 'starter', 'first pass', 'outline',
  'ideas', 'brainstorm', 'anything', 'whatever', 'some', 'a few', 'make me', 'help me'
];

const QUALITY_TERMS = [
  'acceptance criteria', 'criteria', 'rubric', 'evidence', 'sources', 'citations',
  'constraints', 'audience', 'stakeholder', 'review', 'tests', 'examples', 'anti-examples',
  'must include', 'must avoid', 'tradeoffs', 'non-goals', 'edge cases', 'definition of done'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyChallengeDesign(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const outputMatches = countMatches(text, OUTPUT_TERMS);
  const genericMatches = countMatches(text, GENERIC_TERMS);
  const qualityMatches = countMatches(text, QUALITY_TERMS);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const shortPrompt = wordCount <= 22;
  const score = (outputMatches * 2) + genericMatches + (shortPrompt ? 2 : 0) - (qualityMatches * 2);

  if (outputMatches === 0) {
    return { applies: false, reason: 'not output-work shaped', score };
  }
  if (qualityMatches >= 2) {
    return { applies: false, reason: 'operator already supplied quality bar', score };
  }
  if (score < 4) {
    return { applies: false, reason: 'specific enough for direct execution', score };
  }

  const layer = shortPrompt || genericMatches >= 2
    ? 'baseline-ratchet'
    : 'lightweight-quality-bar';

  return {
    applies: true,
    reason: 'broad AI output work should state a higher bar than generic completion',
    score,
    layer,
    signals: {
      output: outputMatches,
      generic: genericMatches,
      quality: qualityMatches,
      word_count: wordCount
    }
  };
}

function challengeDesignPromptBlock(message) {
  const classification = classifyChallengeDesign(message);
  if (!classification.applies) return '';

  return '[CHALLENGE-DESIGN CHECK]\n'
    + 'This request is broad enough that a generic AI answer would be too easy. Briefly raise the bar before doing the work.\n'
    + '- Name the intended audience/user and what would make the output actually useful for them.\n'
    + '- Identify the stale/easy baseline you are avoiding: generic summary, shallow plan, vague advice, or unverified claims.\n'
    + '- Add a compact quality rubric: evidence, critique, originality/fit, tradeoffs, and concrete acceptance criteria where relevant.\n'
    + '- Prefer specific examples, edge cases, and source/provenance notes over filler.\n'
    + '- Keep it proportional: do not ask for clarification; state assumptions and deliver the requested artifact.\n'
    + '[/CHALLENGE-DESIGN CHECK]';
}

function appendChallengeDesignPrompt(message) {
  const block = challengeDesignPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyChallengeDesign,
  challengeDesignPromptBlock,
  appendChallengeDesignPrompt
};
