'use strict';

// Deterministic resilience nudge for AI/provider/tool-dependent workflows.
// Inspired by Jake Van Clief's redundancy/model-swap lesson: useful AI work
// should survive provider outages, quota walls, IDE changes, and chat loss by
// keeping portable state, fallback paths, and verification outside the model.

const AI_DEPENDENCY_TERMS = [
  'ai', 'agent', 'agents', 'llm', 'model', 'provider', 'harness', 'runtime',
  'claude', 'openai', 'gpt', 'gemini', 'ollama', 'cursor', 'codex', 'hermes',
  'openclaw', 'api', 'chat', 'prompt', 'workflow', 'automation', 'dispatch'
];

const FAILURE_TERMS = [
  'down', 'outage', 'offline', 'rate limit', 'rate-limited', 'quota', 'exhausted',
  'degraded', 'fails', 'failure', 'unavailable', 'fallback', 'failover', 'backup',
  'redundancy', 'recover', 'recovery', 'retry', 'manual', 'local', 'swap', 'switch'
];

const CONTINUITY_TERMS = [
  'resume', 'continue', 'portable', 'state', 'handoff', 'runbook', 'manifest',
  'logs', 'artifact', 'artifacts', 'files', 'verify', 'verification', 'test',
  'eval', 'acceptance', 'contract', 'schema', 'degradation', 'stop state'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyWorkflowResilience(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const dependencyMatches = countMatches(text, AI_DEPENDENCY_TERMS);
  const failureMatches = countMatches(text, FAILURE_TERMS);
  const continuityMatches = countMatches(text, CONTINUITY_TERMS);
  const score = (dependencyMatches * 2) + (failureMatches * 3) + (continuityMatches * 2);

  if (dependencyMatches === 0) {
    return { applies: false, reason: 'no AI/provider dependency signal', score };
  }
  if (failureMatches === 0 && continuityMatches < 2) {
    return { applies: false, reason: 'no resilience/fallback signal', score };
  }
  if (score < 7) {
    return { applies: false, reason: 'weak resilience signal', score };
  }

  const layer = failureMatches >= 2 || text.indexOf('failover') !== -1 || text.indexOf('fallback') !== -1
    ? 'provider-fallback'
    : continuityMatches >= 3
      ? 'portable-state'
      : 'degradation-plan';

  return {
    applies: true,
    reason: 'AI workflow needs provider/model resilience and portable state',
    score,
    layer,
    signals: {
      dependency: dependencyMatches,
      failure: failureMatches,
      continuity: continuityMatches
    }
  };
}

function workflowResiliencePromptBlock(message) {
  const classification = classifyWorkflowResilience(message);
  if (!classification.applies) return '';

  return '[WORKFLOW RESILIENCE CHECK]\n'
    + 'This looks like AI/provider/tool-dependent work where outage, quota, model swap, or chat loss could matter. Before finishing, make the workflow resilient enough for another capable operator or model to continue.\n'
    + '- Portable state: name the files, manifests, logs, artifacts, schemas, acceptance criteria, or tests needed to resume without the original chat.\n'
    + '- Provider fallback: name the next harness/model/tool if the preferred provider is down, rate-limited, too expensive, or degraded.\n'
    + '- Local/manual fallback: name the smallest useful path that still works with local tools, deterministic scripts, or human procedure.\n'
    + '- Contract boundary: keep model calls behind stable task contracts, truth decks, schemas, or checklists instead of hidden prompt-only behavior.\n'
    + '- Verification and degradation: state how fallback output is checked and what safe stop/user message applies if every AI path fails.\n'
    + 'Keep this proportional; do not build a platform around a tiny request, but do not leave critical AI work dependent on one model surface.\n'
    + '[/WORKFLOW RESILIENCE CHECK]';
}

function appendWorkflowResiliencePrompt(message) {
  const block = workflowResiliencePromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyWorkflowResilience,
  workflowResiliencePromptBlock,
  appendWorkflowResiliencePrompt
};
