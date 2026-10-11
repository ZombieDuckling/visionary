'use strict';

// Deterministic workbench-outcome review nudge for post-build/training follow-up.
// Inspired by Jake Van Clief's architecture-review lesson: follow-up should inspect
// the actual workbench, adoption evidence, blockers, and reusable program lessons —
// not just ask whether a session felt useful.

const WORKBENCH_TERMS = [
  'workbench', 'workspace', 'folder', 'template', 'pipeline', 'workflow',
  'artifact', 'artifacts', 'dashboard', 'automation', 'agent', 'agents',
  'playbook', 'sop', 'system'
];

const DELIVERY_TERMS = [
  'training', 'workshop', 'session', 'cohort', 'client', 'customer', 'team',
  'pilot', 'poc', 'prototype', 'deployment', 'deployed', 'launch', 'launched',
  'implementation', 'onboarding', 'handoff'
];

const REVIEW_TERMS = [
  'follow up', 'follow-up', 'check in', 'check-in', 'review', 'retrospective',
  'outcome', 'outcomes', 'roi', 'value', 'adoption', 'usage', 'used', 'changed',
  'blocked', 'blocker', 'blockers', 'feedback', 'improve', 'improvement'
];

const EVIDENCE_TERMS = [
  'evidence', 'metric', 'metrics', 'before and after', 'time saved', 'revenue',
  'risk', 'errors', 'frequency', 'owner', 'owners', 'failure mode', 'failure modes',
  'next action', 'next step'
];

const EXISTING_FRAME_TERMS = [
  'architecture walkthrough', 'workbench map', 'outcome capture', 'adoption evidence',
  'program feedback', 'follow-on roi', 'failure modes', 'owner for the next step',
  'named owner'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyWorkbenchOutcomeReview(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const workbench = countMatches(text, WORKBENCH_TERMS);
  const delivery = countMatches(text, DELIVERY_TERMS);
  const review = countMatches(text, REVIEW_TERMS);
  const evidence = countMatches(text, EVIDENCE_TERMS);
  const existingFrame = countMatches(text, EXISTING_FRAME_TERMS);
  const score = (workbench * 2) + (delivery * 2) + (review * 3) + evidence - (existingFrame * 4);

  if (existingFrame >= 2) {
    return { applies: false, reason: 'operator already supplied workbench-outcome review frame', score };
  }
  if (workbench === 0) {
    return { applies: false, reason: 'no workbench/artifact signal', score };
  }
  if (delivery === 0 && review < 2) {
    return { applies: false, reason: 'not a post-delivery or follow-up review', score };
  }
  if (review === 0) {
    return { applies: false, reason: 'no outcome/follow-up review signal', score };
  }
  if (score < 8) {
    return { applies: false, reason: 'weak workbench-outcome review signal', score };
  }

  const layer = evidence >= 2
    ? 'evidence-backed-outcome-review'
    : delivery >= 2
      ? 'post-delivery-architecture-review'
      : 'workbench-follow-up-review';

  return {
    applies: true,
    reason: 'post-build follow-up should inspect artifacts, outcomes, blockers, and reusable lessons',
    score,
    layer,
    signals: { workbench, delivery, review, evidence, existing_frame: existingFrame }
  };
}

function workbenchOutcomeReviewPromptBlock(message) {
  const classification = classifyWorkbenchOutcomeReview(message);
  if (!classification.applies) return '';

  return '[WORKBENCH-OUTCOME REVIEW]\n'
    + 'This looks like a post-build, post-training, or workbench follow-up. Do not settle for a vibe check. Inspect the actual architecture, outcome evidence, blockers, and reusable lessons before recommending the next move.\n'
    + '- Workbench map: name the source inputs, stages/files/scripts/tools/human steps, outputs, and where the artifact currently lives.\n'
    + '- Outcome evidence: compare intended outcome with observed usage, time saved, revenue/risk/error impact, behavior change, and follow-on builds where available.\n'
    + '- Blockers and ownership: list what is blocked, confusing, fragile, leaking, or unowned, and name the owner for the next step.\n'
    + '- Program lesson: identify which missing template, checklist, definition, teaching order, or operator context should be captured for reuse.\n'
    + '- Next action: choose one improvement/unblocker, state verification evidence, and decide whether it belongs in a template, mutable workbench, archive/example, or backlog.\n'
    + 'If outcome evidence is missing, say what artifact or metric must be collected instead of inventing ROI.\n'
    + '[/WORKBENCH-OUTCOME REVIEW]';
}

function appendWorkbenchOutcomeReviewPrompt(message) {
  const block = workbenchOutcomeReviewPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyWorkbenchOutcomeReview,
  workbenchOutcomeReviewPromptBlock,
  appendWorkbenchOutcomeReviewPrompt
};
