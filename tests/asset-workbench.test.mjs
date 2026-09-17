import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyAssetWorkbench,
  assetWorkbenchPromptBlock,
  appendAssetWorkbenchPrompt
} = require('../src/asset-workbench.js');

test('classifyAssetWorkbench ignores ordinary non-asset requests', () => {
  const result = classifyAssetWorkbench('Ask Scout for a quick local market signal summary');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'not asset-workbench shaped');
  assert.equal(assetWorkbenchPromptBlock('Ask Scout for a quick local market signal summary'), '');
});

test('classifyAssetWorkbench detects portable design system workbenches', () => {
  const result = classifyAssetWorkbench('Import the Figma brand assets into a design system workbench with examples and templates');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'portable-design-system-workbench');
  assert.ok(result.signals.assets >= 2);
  assert.ok(result.signals.workbench >= 3);
});

test('classifyAssetWorkbench detects staged motion workbenches', () => {
  const result = classifyAssetWorkbench('Organize logo SVG assets, write scene specs, and render the product animation video');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'staged-motion-workbench');
  assert.ok(result.signals.output >= 1);
});

test('classifyAssetWorkbench detects asset export packages', () => {
  const result = classifyAssetWorkbench('Export the Canva deck, images, and brand fonts into a ZIP handoff package');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'asset-export-package');
});

test('assetWorkbenchPromptBlock names inventory, map, taste, stages, portability, and review gates', () => {
  const block = assetWorkbenchPromptBlock('Import the brand assets and generate a reusable deck template package');
  assert.match(block, /ASSET-WORKBENCH CHECK/);
  assert.match(block, /Source inventory/);
  assert.match(block, /Workbench map/);
  assert.match(block, /Taste rules/);
  assert.match(block, /Staged pipeline/);
  assert.match(block, /Portable output/);
  assert.match(block, /Review gates/);
});

test('appendAssetWorkbenchPrompt preserves original request first', () => {
  const message = 'Build a brand asset workbench and export the deck template';
  const augmented = appendAssetWorkbenchPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[ASSET-WORKBENCH CHECK\]/);
});
