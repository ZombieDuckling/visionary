'use strict';

// Deterministic review-debt nudge for large generated artifacts.
// Inspired by Jake Van Clief's warning that generation is now cheaper than
// comprehension: Visionary agents should make code/docs/design output reviewable
// instead of dumping impressive volume that creates hidden operator debt.

const GENERATION_TERMS = [
  'generate', 'write', 'draft', 'produce', 'create', 'build', 'implement',
  'vibe code', 'vibecode', 'scaffold', 'make', 'ship'
];

const ARTIFACT_TERMS = [
  'app', 'website', 'site', 'dashboard', 'codebase', 'feature', 'module',
  'report', 'document', 'doc', 'spec', 'plan', 'deck', 'proposal', 'audit',
  'research', 'article', 'copy', 'page', 'workflow', 'automation'
];

const VOLUME_TERMS = [
  'big', 'large', 'full', 'complete', 'entire', 'comprehensive', 'detailed',
  'long', 'multi-page', '30-page', 'all', 'from scratch', 'end-to-end',
  'production-ready', 'polished', 'massive'
];

const REVIEW_FRAME_TERMS = [
  'diff', 'summary', 'summaries', 'review', 'reviewable', 'tests', 'test',
  'smoke', 'checklist', 'acceptance', 'risks', 'risk', 'explain', 'explanation',
  'why', 'tradeoff', 'verification', 'verify', 'small increments', 'incremental'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyReviewDebt(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const generation = countMatches(text, GENERATION_TERMS);
  const artifacts = countMatches(text, ARTIFACT_TERMS);
  const volume = countMatches(text, VOLUME_TERMS);
  const reviewFrame = countMatches(text, REVIEW_FRAME_TERMS);
  const score = (generation * 2) + (artifacts * 2) + (volume * 3) - reviewFrame;

  if (generation === 0 || artifacts === 0) {
    return { applies: false, reason: 'not generated-artifact shaped', score };
  }
  if (volume === 0 && score < 6) {
    return { applies: false, reason: 'low review-debt risk', score };
  }
  if (reviewFrame >= 3) {
    return { applies: false, reason: 'operator already supplied review frame', score };
  }
  if (score < 5) {
    return { applies: false, reason: 'weak review-debt signal', score };
  }

  const layer = volume >= 2
    ? 'large-output-review-debt'
    : 'lightweight-reviewability-check';

  return {
    applies: true,
    reason: 'large generated artifacts need reviewability before volume',
    score,
    layer,
    signals: { generation, artifacts, volume, reviewFrame }
  };
}

function reviewDebtPromptBlock(message) {
  const classification = classifyReviewDebt(message);
  if (!classification.applies) return '';

  return '[REVIEW-DEBT CHECK]\n'
    + 'This looks like generated code/docs/design output that could become harder to review than to create. Keep the artifact useful by making comprehension cheap before adding volume.\n'
    + '- Slice: deliver the smallest coherent increment first, or clearly mark optional/unfinished sections instead of hiding scope debt.\n'
    + '- Change summary: name what changed, where, and why a reviewer should care.\n'
    + '- Review surface: provide diffs, file list, outline, examples, screenshots, or checkpoints that let a human inspect the work quickly.\n'
    + '- Verification: include the tests, smoke checks, citations, or acceptance criteria used to prove the output.\n'
    + '- Risk notes: call out assumptions, generated weak spots, follow-up review needs, and anything you cannot personally explain.\n'
    + 'Keep this concise and then deliver the requested artifact.\n'
    + '[/REVIEW-DEBT CHECK]';
}

function appendReviewDebtPrompt(message) {
  const block = reviewDebtPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyReviewDebt,
  reviewDebtPromptBlock,
  appendReviewDebtPrompt
};
