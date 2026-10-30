'use strict';

// Deterministic intent-match review nudge for dispatches that evaluate, accept,
// approve, or reject produced work (code, build, artifact, output). Inspired by
// Jake Van Clief's psychology-of-programming lesson (video zdg1gbkJ1Pw; concept
// psychology-of-programming-embedded-decisions): code and generated artifacts
// are not neutral execution — they encode a chain of human right/wrong
// decisions. The dangerous failure is not "does not run"; it is "runs but solved
// the wrong problem." So a green build is not a correctness signal, and the
// review must gate on intent match (did it solve the operator's actual problem,
// per the operator's stated decisions?) and name whose judgment the artifact
// embeds (the operator's, the model's defaults, the provider's assumptions).
//
// Distinct from vibe-coded-audit (is AI-written software safe with data,
// access, launch), instruction-provenance (whose opinion do borrowed
// instructions carry), review-debt (did the change get real verification at
// all), and opinion-standard (is taste encoded as reviewable material). This
// fires when the operator is deciding on produced work and could silently accept
// "it works" as "it is correct."

// Decision/verdict language: the operator is judging produced work.
const REVIEW_DECISION_TERMS = [
  'verdict', 'decide', 'decision', 'approve', 'approving', 'approved',
  'reject', 'rejecting', 'rejected', 'accept', 'accepting', 'accepted',
  'sign off', 'sign-off', 'grade', 'grading', 'score it', 'judge', 'judging',
  'evaluate', 'evaluating', 'assess', 'assessing', 'is it correct',
  'is this correct', 'is this right', 'is it right', 'did it solve',
  'does it solve', 'did this solve', 'solve the right', 'solved the right',
  'solving the right', 'right problem', 'wrong problem', 'meets the spec',
  'meets the requirement', 'meets the requirements', 'meets the criteria',
  'on spec', 'off spec', 'off-spec', 'quality bar', 'acceptance criteria',
  'meets acceptance', 'solves the problem', 'solved the problem',
  'does it work', 'did it work'
];

// Produced-work objects: something an agent/model actually made.
const WORK_OBJECT_TERMS = [
  'code', 'build', 'app', 'application', 'feature', 'implementation',
  'solution', 'output', 'result', 'deliverable', 'artifact', 'design', 'site',
  'website', 'dashboard', 'endpoint', 'api', 'script', 'module', 'function',
  'refactor', 'change', 'patch', 'diff', 'pr', 'pull request', 'report',
  'document', 'draft', 'plan', 'analysis', 'recommendation', 'work', 'page',
  'screen', 'workflow', 'pipeline', 'release', 'milestone'
];

// If enough of these discipline-specific terms are present, the intent-match
// frame is already established, so we should not nag. Kept deliberately narrow:
// generic phrases like "review path" / "acceptance" appear in other dispatch
// blocks already appended earlier in the same prompt, so matching them here
// would silently suppress this check.
const FRAMED_TERMS = [
  'intent match', 'intent-match', 'matches the intent', 'match the intent',
  'verify against intent', 'authored intent', 'embedded decision',
  'embedded decisions', 'embedded judgment', 'embedded bias', 'judgment layer',
  'judgement layer', 'intent gate', 'intent-match gate', 'right problem gate'
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word-boundary matching so short tokens cannot false-match inside other words.
function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    const pattern = new RegExp('\\b' + escapeRegExp(term) + '\\b');
    return pattern.test(text) ? count + 1 : count;
  }, 0);
}

function classifyIntentMatchReview(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const reviewDecision = countMatches(text, REVIEW_DECISION_TERMS);
  const workObject = countMatches(text, WORK_OBJECT_TERMS);
  const framed = countMatches(text, FRAMED_TERMS);
  const score = (reviewDecision * 3) + workObject;

  if (framed >= 2) {
    return { applies: false, reason: 'intent-match frame already established', score };
  }
  if (reviewDecision === 0) {
    return { applies: false, reason: 'no review/decision language', score };
  }
  if (workObject === 0) {
    return { applies: false, reason: 'review/decision without a produced-work object', score };
  }

  const layer = reviewDecision >= 2 && /\b(right problem|wrong problem|solved the right|solve the right)\b/.test(text)
    ? 'explicit-intent-match'
    : 'implied-intent-match';

  return {
    applies: true,
    reason: 'produced work is being decided on; a green build is not a correctness signal, so gate on intent match and name whose judgment the artifact embeds',
    score,
    layer,
    signals: { reviewDecision, workObject, framed }
  };
}

function intentMatchReviewPromptBlock(message) {
  const classification = classifyIntentMatchReview(message);
  if (!classification.applies) return '';

  return '[INTENT-MATCH REVIEW CHECK]\n'
    + 'This dispatch is deciding on produced work (code, build, artifact, or output). Code is not neutral execution — it is a chain of human right/wrong decisions. The dangerous failure is not "does not run"; it is "runs but solved the wrong problem." Gate on intent match, not runnability, before accepting. Keep this brief and then continue the task.\n'
    + '- Intent criterion: state the operator\'s actual problem and the acceptance criteria that define "right" (constraints, examples, anti-examples) — before treating tests, a green build, or "it runs" as correctness.\n'
    + '- Right-problem question: answer explicitly whether the work solved the right problem in the operator\'s terms. If the problem definition was inherited from a model, provider, or another programmer, name that and reconcile it against the operator\'s intent.\n'
    + '- Embedded judgment: name whose right/wrong decisions the artifact encodes — the operator\'s stated decisions, the model\'s defaults, or the provider\'s assumptions. Treat unclear ownership as a risk, not a neutral default.\n'
    + '- Diagnose the problem definition first: when output is "wrong," ask first whether the right/wrong judgment was the operator\'s; if not, you optimized for someone else\'s problem.\n'
    + '- Verdict: state whether this passes on intent match (solved the right problem, embedding the operator\'s judgment) versus passing only on runnability (compiles/tests green but solved the wrong problem) — and accept, reject, or re-aim the work accordingly.\n'
    + '[/INTENT-MATCH REVIEW CHECK]';
}

function appendIntentMatchReviewPrompt(message) {
  const block = intentMatchReviewPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyIntentMatchReview,
  intentMatchReviewPromptBlock,
  appendIntentMatchReviewPrompt
};
