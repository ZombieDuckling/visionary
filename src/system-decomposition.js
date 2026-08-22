'use strict';

// Deterministic AI-system decomposition nudge for agent/protocol/system dispatches.
// Inspired by the Jake Van Clief "AI system decomposition and protocol review"
// lesson: production AI work is usually a model layer plus ordinary software
// layers for orchestration, connector boundaries, validation, telemetry, evals,
// and human accountability.

const SYSTEM_TERMS = [
  'ai system', 'agent', 'agents', 'orchestration', 'workflow', 'pipeline',
  'automation', 'autonomous', 'multi-agent', 'assistant', 'tool', 'tools',
  'connector', 'integration', 'mcp', 'protocol', 'api', 'webhook', 'cli',
  'server', 'service', 'runtime', 'scheduler', 'queue', 'dispatch'
];

const PRODUCTION_TERMS = [
  'build', 'ship', 'production', 'reliable', 'reliability', 'review', 'audit',
  'validate', 'validation', 'eval', 'evaluation', 'test', 'monitor', 'telemetry',
  'retry', 'fallback', 'rate limit', 'timeout', 'permission', 'secret', 'schema',
  'parse', 'parser', 'state', 'memory', 'database', 'logs', 'cost', 'latency'
];

const DEMO_ONLY_TERMS = [
  'prompt', 'chatbot', 'demo', 'prototype', 'wrapper', 'generate', 'summarize'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifySystemDecomposition(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const systemMatches = countMatches(text, SYSTEM_TERMS);
  const productionMatches = countMatches(text, PRODUCTION_TERMS);
  const demoOnlyMatches = countMatches(text, DEMO_ONLY_TERMS);
  const score = (systemMatches * 2) + productionMatches + demoOnlyMatches;

  if (systemMatches === 0 || score < 4) {
    return { applies: false, reason: 'not AI-system/protocol shaped', score };
  }

  const layer = productionMatches >= 3
    ? 'production-system'
    : demoOnlyMatches > productionMatches
      ? 'demo-to-system-risk'
      : 'agent-or-protocol-work';

  return {
    applies: true,
    reason: 'AI-system/protocol dispatch',
    score,
    layer,
    signals: {
      system: systemMatches,
      production: productionMatches,
      demo_only: demoOnlyMatches
    }
  };
}

function systemDecompositionPromptBlock(message) {
  const classification = classifySystemDecomposition(message);
  if (!classification.applies) return '';

  return '[SYSTEM-DECOMPOSITION CHECK]\n'
    + 'Before building or dispatching this AI-system work, name the concrete layers so the result is not just a fragile prompt demo. Keep this brief and practical.\n'
    + '- Model call: what model/runtime is used, with what context and output contract?\n'
    + '- Orchestration: what code, queue, scheduler, retry, timeout, or routing logic controls the next step?\n'
    + '- Protocol/tool boundary: what API/CLI/files/database/tools are reachable, and where are permissions/secrets isolated?\n'
    + '- Parsing/validation: how does unstructured output become checked structured data or artifacts?\n'
    + '- Eval/telemetry: what success criteria, logs, cost/latency signals, or regression checks prove it worked?\n'
    + '- Human accountability: what needs operator approval, review, or rollback?\n'
    + 'Apply only the layers needed for the requested scope; do not over-engineer.\n'
    + '[/SYSTEM-DECOMPOSITION CHECK]';
}

function appendSystemDecompositionPrompt(message) {
  const block = systemDecompositionPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifySystemDecomposition,
  systemDecompositionPromptBlock,
  appendSystemDecompositionPrompt
};
