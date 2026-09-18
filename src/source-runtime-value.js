'use strict';

// Deterministic source-runtime value nudge for clone/import/leak/source-code work.
// Inspired by Jake Van Clief's "Claude source leak" lesson: source code alone is
// not captured product value. The durable value is in runtime wiring, data,
// permissions, deployment, customer workflow fit, operations, and delivery.

const SOURCE_TERMS = [
  'source', 'source code', 'codebase', 'repo', 'repository', 'github', 'clone',
  'fork', 'import', 'leak', 'leaked', 'template', 'starter', 'scaffold', 'copy',
  'reverse engineer', 'reimplement', 'port', 'migrate'
];

const PRODUCT_TERMS = [
  'app', 'product', 'platform', 'dashboard', 'system', 'service', 'tool', 'agent',
  'workflow', 'customer', 'user', 'client', 'market', 'feature', 'saas', 'mvp'
];

const RUNTIME_TERMS = [
  'runtime', 'deploy', 'deployment', 'host', 'hosting', 'database', 'db', 'data',
  'auth', 'permission', 'permissions', 'secret', 'secrets', 'credential',
  'integration', 'api', 'cli', 'queue', 'scheduler', 'monitoring', 'logs',
  'tests', 'ci', 'ops', 'operate', 'onboarding'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifySourceRuntimeValue(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const source = countMatches(text, SOURCE_TERMS);
  const product = countMatches(text, PRODUCT_TERMS);
  const runtime = countMatches(text, RUNTIME_TERMS);
  const score = (source * 2) + product + (runtime * 2);

  if (source === 0 || score < 5) {
    return { applies: false, reason: 'not source/import-to-product shaped', score };
  }

  const layer = runtime >= 3
    ? 'runtime-value-audit'
    : product >= 2
      ? 'source-to-product-gap'
      : 'source-capture-risk';

  return {
    applies: true,
    reason: 'source code/template/import work needs runtime value check',
    score,
    layer,
    signals: { source, product, runtime }
  };
}

function sourceRuntimeValuePromptBlock(message) {
  const classification = classifySourceRuntimeValue(message);
  if (!classification.applies) return '';

  return '[SOURCE-RUNTIME VALUE CHECK]\n'
    + 'This looks like source-code, template, clone, import, or leaked-code work. Do not treat copied source as captured product value. Before building, name the runtime/product gaps and then continue the requested task.\n'
    + '- Source inventory: what code/template/repo/artifact is being reused, and what license/trust/provenance limits apply?\n'
    + '- Runtime wiring: what database, auth, secrets, permissions, queues, schedulers, integrations, deploy target, and logs make it actually run?\n'
    + '- Workflow fit: what user/customer/operator job must it serve, and what source-code behavior is irrelevant or unsafe for this context?\n'
    + '- Delivery proof: what setup path, smoke test, fixture, artifact, screenshot/log, or acceptance check proves the imported code became usable software?\n'
    + '- Value boundary: avoid cloning surface area that does not improve reliability, workflow fit, or maintainability.\n'
    + 'Keep this concise; use it to prevent wrapper cargo-culting, not to stall execution.\n'
    + '[/SOURCE-RUNTIME VALUE CHECK]';
}

function appendSourceRuntimeValuePrompt(message) {
  const block = sourceRuntimeValuePromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifySourceRuntimeValue,
  sourceRuntimeValuePromptBlock,
  appendSourceRuntimeValuePrompt
};
