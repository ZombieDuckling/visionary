'use strict';

// Deterministic asset-workbench nudge for dispatches that turn brand/design
// assets into reusable workbenches or exported deliverables. Inspired by Jake Van
// Clief's Claude Design import/export lesson: spend model effort once to map
// assets, preserve source material, encode taste rules, stage generation, and
// leave a portable package that works outside a hosted design UI.

const ASSET_TERMS = [
  'asset', 'assets', 'brand', 'design system', 'figma', 'canva', 'slide', 'slides',
  'deck', 'image', 'images', 'svg', 'logo', 'logos', 'font', 'fonts', 'typography',
  'color', 'colors', 'component', 'components', 'animation', 'video', 'scene', 'scenes'
];

const WORKBENCH_TERMS = [
  'workbench', 'folder', 'repo', 'repository', 'package', 'bundle', 'import',
  'ingest', 'organize', 'source map', 'map', 'template', 'templates', 'examples',
  'style guide', 'brand guide', 'system'
];

const OUTPUT_TERMS = [
  'export', 'produce', 'generate', 'render', 'convert', 'handoff', 'deliver',
  'publish', 'html', 'ppt', 'pptx', 'pdf', 'zip', 'prototype', 'landing page',
  'website', 'motion', 'cut', 'edit'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyAssetWorkbench(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const assetMatches = countMatches(text, ASSET_TERMS);
  const workbenchMatches = countMatches(text, WORKBENCH_TERMS);
  const outputMatches = countMatches(text, OUTPUT_TERMS);
  const score = (assetMatches * 2) + (workbenchMatches * 2) + outputMatches;

  if (assetMatches === 0 || (workbenchMatches === 0 && outputMatches === 0)) {
    return { applies: false, reason: 'not asset-workbench shaped', score };
  }
  if (score < 7) {
    return { applies: false, reason: 'weak asset-workbench signal', score };
  }

  const layer = text.indexOf('animation') !== -1 || text.indexOf('video') !== -1 || text.indexOf('scene') !== -1 || text.indexOf('render') !== -1
    ? 'staged-motion-workbench'
    : workbenchMatches >= 3 || text.indexOf('design system') !== -1 || text.indexOf('brand guide') !== -1
      ? 'portable-design-system-workbench'
      : 'asset-export-package';

  return {
    applies: true,
    reason: 'asset/design work should preserve source assets and produce a portable workbench',
    score,
    layer,
    signals: {
      assets: assetMatches,
      workbench: workbenchMatches,
      output: outputMatches
    }
  };
}

function assetWorkbenchPromptBlock(message) {
  const classification = classifyAssetWorkbench(message);
  if (!classification.applies) return '';

  return '[ASSET-WORKBENCH CHECK]\n'
    + 'If this task imports, organizes, or exports brand/design/media assets, build around a reusable asset workbench rather than a one-off chat answer. Keep this proportional to the task.\n'
    + '- Source inventory: name the input assets/folders/repos and keep originals separate from generated outputs.\n'
    + '- Workbench map: state the folders/files that route brand rules, examples, components, scripts, and outputs.\n'
    + '- Taste rules: capture concrete colors, typography, spacing, examples, anti-examples, and non-negotiables before generation.\n'
    + '- Staged pipeline: for decks/sites/animation/video, separate spec, scenes/components, render/export commands, and final artifacts.\n'
    + '- Portable output: produce or describe source plus rendered/exported files so another model/tool can continue without the hosted UI.\n'
    + '- Review gates: list fidelity checks and human approval points before treating the asset package as final.\n'
    + 'Do not invent missing brand facts; mark gaps plainly and keep source paths exact.\n'
    + '[/ASSET-WORKBENCH CHECK]';
}

function appendAssetWorkbenchPrompt(message) {
  const block = assetWorkbenchPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyAssetWorkbench,
  assetWorkbenchPromptBlock,
  appendAssetWorkbenchPrompt
};