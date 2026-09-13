import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyLearningLoop,
  learningLoopPromptBlock,
  appendLearningLoopPrompt
} = require('../src/learning-loop.js');

test('classifyLearningLoop ignores empty and non-learning operational prompts', () => {
  assert.equal(classifyLearningLoop('').applies, false);
  const result = classifyLearningLoop('Restart the server and check the health endpoint');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no learning signal');
  assert.equal(learningLoopPromptBlock('Restart the server and check the health endpoint'), '');
});

test('classifyLearningLoop detects passive learning requests', () => {
  const result = classifyLearningLoop('Teach me how to understand SQLite migrations');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'active-learning-loop');
  assert.ok(result.score >= 5);
  assert.ok(result.signals.learning >= 2);
});

test('classifyLearningLoop detects curriculum/training requests', () => {
  const result = classifyLearningLoop('Create a training curriculum for new ops agents');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'curriculum-with-reps');
  assert.ok(result.signals.output >= 1);
});

test('classifyLearningLoop does not nag when practice and feedback are already specified', () => {
  const message = 'Build a learning guide with exercises, a rubric, common mistakes, and a proof project';
  const result = classifyLearningLoop(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'operator already supplied practice/feedback frame');
});

test('learningLoopPromptBlock asks for skill reps feedback and transfer proof', () => {
  const block = learningLoopPromptBlock('Explain how to learn prompt injection testing');
  assert.match(block, /LEARNING-LOOP CHECK/);
  assert.match(block, /Target skill/);
  assert.match(block, /Active reps/);
  assert.match(block, /Feedback path/);
  assert.match(block, /Transfer proof/);
});

test('appendLearningLoopPrompt preserves original request first', () => {
  const message = 'Make a quick tutorial for learning agent routing';
  const augmented = appendLearningLoopPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[LEARNING-LOOP CHECK\]/);
});
