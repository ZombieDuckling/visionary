'use strict';

// Deterministic abstraction-layer nudge for product/workflow dispatches.
// Inspired by the Jake Van Clief "abstraction layer value capture" lesson:
// avoid treating raw AI output as the moat when the valuable layer is usually
// workflow, context, interaction, data, review, and learning from use.

const PRODUCT_TERMS = [
  'product', 'workflow', 'dashboard', 'platform', 'feature', 'ux', 'ui',
  'interface', 'onboarding', 'customer', 'client', 'user', 'users', 'market',
  'saas', 'portal', 'app', 'automation', 'agent', 'orchestration', 'template',
  'system', 'integration', 'process', 'service', 'role', 'persona'
];

const BUILD_TERMS = [
  'build', 'design', 'implement', 'improve', 'create', 'prototype', 'ship',
  'launch', 'validate', 'automate', 'refactor', 'make', 'turn into', 'convert'
];

const RAW_OUTPUT_TERMS = [
  'generate', 'write', 'summarize', 'copy', 'content', 'report', 'page',
  'transcript', 'document', 'html', 'landing page', 'blog', 'email'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyValueLayer(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const productMatches = countMatches(text, PRODUCT_TERMS);
  const buildMatches = countMatches(text, BUILD_TERMS);
  const rawOutputMatches = countMatches(text, RAW_OUTPUT_TERMS);
  const score = (productMatches * 2) + buildMatches + rawOutputMatches;

  if (productMatches === 0 && score < 3) {
    return { applies: false, reason: 'not product/workflow shaped', score };
  }

  const layer = rawOutputMatches > productMatches
    ? 'raw-output-to-workflow'
    : productMatches >= 2
      ? 'workflow-or-interactive-system'
      : 'feature-or-automation';

  return {
    applies: true,
    reason: 'product/workflow dispatch',
    score,
    layer,
    signals: {
      product: productMatches,
      build: buildMatches,
      raw_output: rawOutputMatches
    }
  };
}

function valueLayerPromptBlock(message) {
  const classification = classifyValueLayer(message);
  if (!classification.applies) return '';

  return '[VALUE-LAYER CHECK]\n'
    + 'Before executing, briefly identify the abstraction layer for this work. Do not overbuild a raw-output feature if the durable value is the workflow/context layer above it.\n'
    + '- Raw output/feature: what is the cheap or vendor-commoditizable part?\n'
    + '- Defensible context: what local data, workflow, taste, permissions, review loop, or role-specific judgment makes this useful?\n'
    + '- Smallest prototype: what is the lowest-risk version that proves demand before productizing?\n'
    + '- Review/telemetry: what evidence should Visionary save so the operator can verify and the system can learn?\n'
    + 'Apply these answers practically; keep the requested deliverable first.\n'
    + '[/VALUE-LAYER CHECK]';
}

function appendValueLayerPrompt(message) {
  const block = valueLayerPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyValueLayer,
  valueLayerPromptBlock,
  appendValueLayerPrompt
};
