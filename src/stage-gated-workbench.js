'use strict';

// Deterministic stage-gated workbench nudge for costly/generated deliverables.
// Inspired by Jake Van Clief's pipeline lesson: don't jump straight from prompt
// to final artifact when staged source, metadata, preview, and approval gates make
// the work easier to review, repair, and resume from files.

const DELIVERABLE_TERMS = [
  'video', 'voice', 'audio', 'podcast', 'animation', 'render', 'media',
  'deck', 'slides', 'presentation', 'campaign', 'landing page', 'website',
  'report', 'whitepaper', 'course', 'tutorial', 'onboarding', 'playbook',
  'app', 'prototype', 'workflow', 'pipeline', 'workbench', 'publish', 'launch'
];

const GENERATION_TERMS = [
  'generate', 'create', 'produce', 'build', 'draft', 'write', 'design', 'render',
  'edit', 'package', 'export', 'publish', 'ship', 'make', 'assemble'
];

const COMPLEXITY_TERMS = [
  'final', 'client', 'public', 'review', 'approve', 'approval', 'qa', 'quality',
  'metadata', 'transcript', 'storyboard', 'spec', 'preview', 'staged', 'stage',
  'source', 'assets', 'chunk', 'reroll', 'check', 'checks', 'human'
];

const EXISTING_GATE_TERMS = [
  'stage gate', 'stage-gate', 'staged pipeline', 'human check', 'review gate',
  'approval gate', 'input/output', 'input, do, output', 'source brief'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function hasExistingGateFrame(text) {
  return EXISTING_GATE_TERMS.some(function (term) { return text.indexOf(term) !== -1; });
}

function classifyStageGatedWorkbench(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }
  if (hasExistingGateFrame(text)) {
    return { applies: false, reason: 'already stage-gated', score: 0 };
  }

  const deliverableMatches = countMatches(text, DELIVERABLE_TERMS);
  const generationMatches = countMatches(text, GENERATION_TERMS);
  const complexityMatches = countMatches(text, COMPLEXITY_TERMS);
  const score = (deliverableMatches * 2) + generationMatches + (complexityMatches * 2);

  if (deliverableMatches === 0 || generationMatches === 0) {
    return { applies: false, reason: 'not a generated deliverable workflow', score };
  }
  if (score < 6) {
    return { applies: false, reason: 'weak stage-gate signal', score };
  }

  const layer = text.indexOf('video') !== -1 || text.indexOf('voice') !== -1 || text.indexOf('animation') !== -1 || text.indexOf('render') !== -1
    ? 'media-pipeline'
    : text.indexOf('deck') !== -1 || text.indexOf('slides') !== -1 || text.indexOf('campaign') !== -1 || text.indexOf('landing page') !== -1
      ? 'publish-package-pipeline'
      : text.indexOf('app') !== -1 || text.indexOf('prototype') !== -1 || text.indexOf('workflow') !== -1 || text.indexOf('workbench') !== -1
        ? 'software-workbench-pipeline'
        : 'document-workflow-pipeline';

  return {
    applies: true,
    reason: 'costly generated deliverables need staged source, preview, and human review gates',
    score,
    layer,
    signals: {
      deliverable: deliverableMatches,
      generation: generationMatches,
      complexity: complexityMatches
    }
  };
}

function stageGatedWorkbenchPromptBlock(message) {
  const classification = classifyStageGatedWorkbench(message);
  if (!classification.applies) return '';

  return '[STAGE-GATED WORKBENCH CHECK]\n'
    + 'If this task creates a costly-to-review deliverable, do not jump straight from prompt to final output. Keep the pipeline proportional, but expose stages so the operator can inspect, repair, and resume it.\n'
    + '- Stage table: for each meaningful stage, state Input, Do, Output, and Human check.\n'
    + '- Source first: preserve the brief/source files separately from generated assets and final exports.\n'
    + '- Metadata/spec before render: create cheap structure first — transcript, cue table, storyboard, outline, acceptance spec, or manifest — before expensive generation.\n'
    + '- Preview gate: produce a reviewable preview, still, diff, sample, or dry-run output before treating the package as final.\n'
    + '- Deterministic checks: use scripts/rules for exact counts, paths, formats, links, timing, schemas, or drift instead of asking chat to eyeball them.\n'
    + '- Repairability: chunk outputs where local rerolls/fixes should not regenerate the whole deliverable.\n'
    + '- Final package: list source artifacts, generated outputs, final exports, approval status, and the next resume point.\n'
    + 'Mark missing inputs or approval gaps plainly; do not invent source files, rights, or human sign-off.\n'
    + '[/STAGE-GATED WORKBENCH CHECK]';
}

function appendStageGatedWorkbenchPrompt(message) {
  const block = stageGatedWorkbenchPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyStageGatedWorkbench,
  stageGatedWorkbenchPromptBlock,
  appendStageGatedWorkbenchPrompt
};
