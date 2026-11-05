import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyInterfaceLayerSelection,
  interfaceLayerPromptBlock,
  appendInterfaceLayerPrompt
} = require('../src/interface-layer-selection.js');

test('classifyInterfaceLayerSelection ignores empty and ordinary operational prompts', () => {
  assert.equal(classifyInterfaceLayerSelection('').applies, false);
  const result = classifyInterfaceLayerSelection('Restart the dashboard server and check the logs');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no tool/model/runtime/agent named');
  assert.equal(interfaceLayerPromptBlock('Restart the dashboard server and check the logs'), '');
});

test('classifyInterfaceLayerSelection ignores descriptive (non-choice) tool mentions', () => {
  const result = classifyInterfaceLayerSelection('The model runs the workflow each morning');
  assert.equal(result.applies, false);
});

test('classifyInterfaceLayerSelection fires on choosing a tool to browse and save files', () => {
  const result = classifyInterfaceLayerSelection('Which tool should we use to let the agent browse the web and save files to our repo?');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'access-boundary-check');
  assert.ok(result.signals.tool >= 1);
  assert.ok(result.signals.access >= 2);
});

test('classifyInterfaceLayerSelection fires on standing up an agent with file/edit/state access', () => {
  const result = classifyInterfaceLayerSelection('Set up an agent that can read and edit our repo files and persist state between runs');
  assert.equal(result.applies, true);
  assert.ok(result.signals.choice >= 1);
});

test('classifyInterfaceLayerSelection fires a layer-selection check on lighter access signals', () => {
  const result = classifyInterfaceLayerSelection('Which runtime should we use to connect the assistant to our API');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'layer-selection-check');
});

test('classifyInterfaceLayerSelection steps back when the operator already named the layer and its access need', () => {
  const message = 'Use an IDE agent as the access layer to edit repo files and run tests, keeping the permissions boundary explicit';
  const result = classifyInterfaceLayerSelection(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'operator already named the layer and its access need');
});

test('interfaceLayerPromptBlock asks for access need, simplest layer, state routing, boundary and verdict', () => {
  const block = interfaceLayerPromptBlock('Which tool should we use to let the agent browse the web and save files to our repo?');
  assert.match(block, /INTERFACE-LAYER CHECK/);
  assert.match(block, /Access need/);
  assert.match(block, /Simplest sufficient layer/);
  assert.match(block, /State routing/);
  assert.match(block, /Secret and visibility boundary/);
  assert.match(block, /Versioning/);
  assert.match(block, /Verdict/);
});

test('appendInterfaceLayerPrompt preserves the original request first', () => {
  const message = 'Set up an agent that can read and edit our repo files and persist state between runs';
  const augmented = appendInterfaceLayerPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[INTERFACE-LAYER CHECK\]/);
});
