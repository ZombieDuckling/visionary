import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractUsageTelemetry, extractExplicitUsage, estimateCost, isLocalModel } = require('../src/usage-telemetry.js');

test('extractExplicitUsage reads Claude-style usage and provider cost', () => {
  const parsed = {
    result: 'done',
    usage: { input_tokens: 1234, output_tokens: 56 },
    total_cost_usd: 0.042
  };

  const usage = extractExplicitUsage(parsed);
  assert.deepEqual(usage, {
    input_tokens: 1234,
    output_tokens: 56,
    estimated: false,
    source: 'explicit',
    reported_cost_usd: 0.042
  });
});

test('extractUsageTelemetry supports alternate token field names', () => {
  const telemetry = extractUsageTelemetry({
    rawOutput: JSON.stringify({ token_usage: { prompt_tokens: 100, completion_tokens: 25 } }),
    agentConfig: { model: 'GPT-5.4-mini', runtime: 'openclaw' }
  });

  assert.equal(telemetry.input_tokens, 100);
  assert.equal(telemetry.output_tokens, 25);
  assert.equal(telemetry.source, 'explicit');
  assert.equal(telemetry.estimated, false);
  assert.equal(telemetry.estimated_cost_usd, (100 * 0.003 + 25 * 0.015) / 1000);
});

test('extractUsageTelemetry estimates non-reporting harness output from prompt and result text', () => {
  const telemetry = extractUsageTelemetry({
    rawOutput: 'plain text answer from a CLI',
    resultText: 'abcd efgh ijkl mnop',
    message: '12345678',
    agentConfig: { model: 'GPT-5.4-mini', runtime: 'openclaw' }
  });

  assert.equal(telemetry.input_tokens, 2);
  assert.equal(telemetry.output_tokens, 5);
  assert.equal(telemetry.source, 'estimated');
  assert.equal(telemetry.estimated, true);
  assert.equal(telemetry.estimated_cost_usd, (2 * 0.003 + 5 * 0.015) / 1000);
});

test('estimateCost applies local cheap rate to local/llama/ollama agents', () => {
  assert.equal(isLocalModel({ model: 'llama3.2:3b (local)', runtime: 'openclaw' }, 'openclaw'), true);
  assert.equal(isLocalModel({ model: 'anything', runtime: 'ollama' }, 'ollama'), true);
  assert.equal(estimateCost(1000, 1000, { model: 'llama3.2:3b (local)', runtime: 'openclaw' }, 'openclaw'), 0.0002);
});

test('reported provider cost wins over estimated rate', () => {
  const telemetry = extractUsageTelemetry({
    rawOutput: JSON.stringify({ usage: { input_tokens: 10, output_tokens: 10 }, total_cost_usd: 0.99 }),
    agentConfig: { model: 'GPT-5.4', runtime: 'claude' }
  });

  assert.equal(telemetry.estimated_cost_usd, 0.99);
});
