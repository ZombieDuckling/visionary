'use strict';

// Usage telemetry normalization for agent runs.
//
// Inspired by Jake Van Clief's "AI as an intent/compiler layer" lesson: agent
// outputs need deterministic parsing, explicit telemetry, and safe fallbacks
// instead of relying on one provider-specific JSON shape. This module keeps that
// contract small and local-first: no network calls, no provider SDKs, just parse
// known fields and estimate when the harness does not report usage.

const { estimateTokens } = require('./guardrails');

const COST_RATES_PER_1K = {
  local: { input: 0.0001, output: 0.0001 },
  default: { input: 0.003, output: 0.015 }
};

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function firstNumber() {
  for (let i = 0; i < arguments.length; i++) {
    const n = numberOrNull(arguments[i]);
    if (n !== null) return n;
  }
  return null;
}

function safeJsonParse(text) {
  try { return JSON.parse(String(text || '')); } catch { return null; }
}

function extractExplicitUsage(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;

  const usage = parsed.usage || parsed.token_usage || parsed.tokens || parsed.metrics || parsed.meta || {};
  const inputTokens = firstNumber(
    usage.input_tokens,
    usage.prompt_tokens,
    usage.promptTokens,
    usage.input,
    usage.inputTokens,
    parsed.input_tokens,
    parsed.prompt_tokens
  );
  const outputTokens = firstNumber(
    usage.output_tokens,
    usage.completion_tokens,
    usage.completionTokens,
    usage.output,
    usage.outputTokens,
    parsed.output_tokens,
    parsed.completion_tokens
  );

  if (inputTokens === null && outputTokens === null) return null;

  return {
    input_tokens: inputTokens || 0,
    output_tokens: outputTokens || 0,
    estimated: false,
    source: 'explicit',
    reported_cost_usd: firstNumber(
      parsed.total_cost_usd,
      parsed.cost_usd,
      parsed.estimated_cost_usd,
      usage.total_cost_usd,
      usage.cost_usd,
      usage.cost
    )
  };
}

function isLocalModel(agentConfig, harness) {
  const model = String((agentConfig && agentConfig.model) || '').toLowerCase();
  const runtime = String((agentConfig && agentConfig.runtime) || harness || '').toLowerCase();
  return runtime === 'ollama' || model.indexOf('llama') !== -1 || model.indexOf('local') !== -1;
}

function estimateCost(inputTokens, outputTokens, agentConfig, harness, reportedCost) {
  if (reportedCost !== null && reportedCost !== undefined) return reportedCost;
  const rates = isLocalModel(agentConfig, harness) ? COST_RATES_PER_1K.local : COST_RATES_PER_1K.default;
  return ((inputTokens || 0) * rates.input + (outputTokens || 0) * rates.output) / 1000;
}

function extractUsageTelemetry(options) {
  options = options || {};
  const parsed = safeJsonParse(options.rawOutput);
  let usage = extractExplicitUsage(parsed);

  if (!usage) {
    const prompt = String(options.message || '');
    const output = String(options.resultText || options.rawOutput || '');
    usage = {
      input_tokens: estimateTokens(prompt),
      output_tokens: estimateTokens(output),
      estimated: true,
      source: 'estimated',
      reported_cost_usd: null
    };
  }

  const cost = estimateCost(
    usage.input_tokens,
    usage.output_tokens,
    options.agentConfig,
    options.harness,
    usage.reported_cost_usd
  );

  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    estimated_cost_usd: cost,
    estimated: usage.estimated,
    source: usage.source
  };
}

module.exports = {
  extractUsageTelemetry,
  extractExplicitUsage,
  estimateCost,
  isLocalModel
};
