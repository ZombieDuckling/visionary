import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyAiAsCompilerPipeline,
  aiAsCompilerPipelinePromptBlock,
  appendAiAsCompilerPipelinePrompt
} = require('../src/ai-as-compiler-pipeline.js');

test('classifyAiAsCompilerPipeline ignores empty and unrelated prompts', () => {
  assert.equal(classifyAiAsCompilerPipeline('').applies, false);
  const result = classifyAiAsCompilerPipeline('Fix the broken settings route');
  assert.equal(result.applies, false);
  assert.equal(aiAsCompilerPipelinePromptBlock('Rename this file'), '');
});

test('classifyAiAsCompilerPipeline flags a repeated generation workflow with variable data', () => {
  const result = classifyAiAsCompilerPipeline('Build a repeatable pipeline that generates a client report for each lead from our CSV');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'structured-output-pipeline');
  assert.ok(result.signals.repeat >= 1);
  assert.ok(result.signals.generation >= 1);
  assert.ok(result.signals.variable >= 1);
});

test('classifyAiAsCompilerPipeline flags a templated batch with a schema', () => {
  const result = classifyAiAsCompilerPipeline('Turn our prompt into a template so we can batch generate structured JSON for every record');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'structured-output-pipeline');
});

test('classifyAiAsCompilerPipeline ignores a one-off generation with no repeat signal', () => {
  const result = classifyAiAsCompilerPipeline('Write me a short summary of this article');
  assert.equal(result.applies, false);
});

test('classifyAiAsCompilerPipeline ignores an AI pipeline with no compilation surface', () => {
  const result = classifyAiAsCompilerPipeline('Build an AI pipeline');
  assert.equal(result.applies, false);
});

test('classifyAiAsCompilerPipeline respects an operator-supplied compiler-map frame', () => {
  const result = classifyAiAsCompilerPipeline('Build the pipeline following the compiler map with fixed instruction and output schema already defined');
  assert.equal(result.applies, false);
});

test('aiAsCompilerPipelinePromptBlock names compiler map, fixed/variable, schema, validation and verdict', () => {
  const block = aiAsCompilerPipelinePromptBlock('Set up a repeatable pipeline that generates summaries for each client from the dataset');
  assert.match(block, /AI-AS-COMPILER PIPELINE CHECK/);
  assert.match(block, /Compiler map/);
  assert.match(block, /Fixed vs variable/);
  assert.match(block, /Structured output/);
  assert.match(block, /Compilation environment/);
  assert.match(block, /Validation before trust/);
  assert.match(block, /Verdict:/);
});

test('aiAsCompilerPipelinePromptBlock emits real newlines, not literal backslash-n', () => {
  const block = aiAsCompilerPipelinePromptBlock('Set up a repeatable pipeline that generates summaries for each client from the dataset');
  assert.equal((block.match(/\\n/g) || []).length, 0);
  assert.ok((block.match(/\n/g) || []).length >= 8);
});

test('appendAiAsCompilerPipelinePrompt preserves the original request first', () => {
  const message = 'Batch-generate a structured JSON summary for every lead in the file';
  const augmented = appendAiAsCompilerPipelinePrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[AI-AS-COMPILER PIPELINE CHECK\]/);
});

test('appendAiAsCompilerPipelinePrompt is a no-op on unrelated prompts', () => {
  assert.equal(appendAiAsCompilerPipelinePrompt('Deploy the new build'), 'Deploy the new build');
});
