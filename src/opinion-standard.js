'use strict';

// Deterministic opinion-standard nudge for dispatches where the operator asks
// an agent to encode taste, preferences, principles, rubrics, or decision
// standards. Inspired by Jake Van Clief's "automate your opinions" lesson:
// stable judgment should become reviewable source material with examples,
// boundaries, and acceptance checks instead of disappearing into chat tone.

const STANDARD_TERMS = [
  'opinion', 'opinions', 'taste', 'preference', 'preferences', 'standard', 'standards',
  'principle', 'principles', 'judgment', 'judgement', 'rubric', 'criteria', 'quality bar',
  'style guide', 'brand rules', 'voice', 'tone', 'values', 'do and don\'t', 'dos and don\'ts'
];

const CODIFY_TERMS = [
  'automate', 'encode', 'codify', 'capture', 'write', 'document', 'turn into', 'make',
  'build', 'create', 'formalize', 'systematize', 'teach', 'train', 'apply', 'enforce'
];

const DECISION_TERMS = [
  'review', 'approve', 'reject', 'decide', 'choose', 'rank', 'score', 'evaluate',
  'critique', 'acceptance', 'must avoid', 'examples', 'anti-examples', 'checklist'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyOpinionStandard(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const standardMatches = countMatches(text, STANDARD_TERMS);
  const codifyMatches = countMatches(text, CODIFY_TERMS);
  const decisionMatches = countMatches(text, DECISION_TERMS);
  const score = (standardMatches * 3) + (codifyMatches * 2) + decisionMatches;

  if (standardMatches === 0) {
    return { applies: false, reason: 'no taste or standard signal', score };
  }
  if (codifyMatches === 0 && decisionMatches === 0) {
    return { applies: false, reason: 'standard mentioned without encoding or review work', score };
  }
  if (score < 6) {
    return { applies: false, reason: 'weak opinion-standard signal', score };
  }

  const layer = text.indexOf('rubric') !== -1 || text.indexOf('criteria') !== -1 || text.indexOf('score') !== -1 || text.indexOf('evaluate') !== -1
    ? 'review-rubric'
    : text.indexOf('style guide') !== -1 || text.indexOf('brand') !== -1 || text.indexOf('voice') !== -1 || text.indexOf('tone') !== -1
      ? 'taste-guide'
      : 'codified-judgment';

  return {
    applies: true,
    reason: 'stable taste and judgment should be encoded as reusable review material',
    score,
    layer,
    signals: {
      standard: standardMatches,
      codify: codifyMatches,
      decision: decisionMatches
    }
  };
}

function opinionStandardPromptBlock(message) {
  const classification = classifyOpinionStandard(message);
  if (!classification.applies) return '';

  return '[OPINION-STANDARD CHECK]\n'
    + 'This request touches taste, preferences, principles, or review judgment. Turn the opinion into reusable operating material instead of burying it in prose.\n'
    + '- Source standard: name the canonical file, examples, prior decisions, or user preference evidence that anchors the standard.\n'
    + '- Decision boundary: say what this standard should decide, what it should not decide, and who gets final override.\n'
    + '- Examples and anti-examples: include concrete pass/fail cases, not just adjectives.\n'
    + '- Review rubric: list the small set of checks an agent can apply consistently when approving, rejecting, ranking, or revising work.\n'
    + '- Revision path: note how new operator feedback should update the standard without overfitting one incident.\n'
    + 'Keep it proportional; do the requested work and leave behind a standard the next run can reuse.\n'
    + '[/OPINION-STANDARD CHECK]';
}

function appendOpinionStandardPrompt(message) {
  const block = opinionStandardPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyOpinionStandard,
  opinionStandardPromptBlock,
  appendOpinionStandardPrompt
};
