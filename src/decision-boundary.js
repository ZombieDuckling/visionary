'use strict';

// Deterministic decision-boundary nudge for AI capability/risk/deployment work.
// Inspired by Jake Van Clief's boundary-setting shorts: technical capability,
// ethical permission, deployment responsibility, and human-support needs are
// separate layers and should not be collapsed into vague "AI can/can't" claims.

const AI_TERMS = [
  'ai', 'agent', 'agents', 'automation', 'automated', 'model', 'llm', 'classifier',
  'assistant', 'chatbot', 'copilot', 'workflow', 'system'
];

const CAPABILITY_TERMS = [
  'can', 'cannot', "can't", 'able', 'capability', 'capabilities', 'detect', 'predict',
  'score', 'rank', 'recommend', 'generate', 'write', 'replace', 'assess', 'evaluate',
  'decide', 'decision', 'triage'
];

const ETHICS_TERMS = [
  'ethic', 'ethics', 'ethical', 'risk', 'risky', 'harm', 'safe', 'safety', 'allowed',
  'permission', 'consent', 'bias', 'fairness', 'policy', 'governance', 'approval'
];

const DEPLOYMENT_TERMS = [
  'deploy', 'deployment', 'ship', 'production', 'prod', 'rollout', 'launch', 'user',
  'users', 'customer', 'customers', 'human', 'review', 'owner', 'responsibility',
  'accountable', 'escalation', 'support', 'grief', 'trauma', 'emotion', 'emotional'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyDecisionBoundary(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const ai = countMatches(text, AI_TERMS);
  const capability = countMatches(text, CAPABILITY_TERMS);
  const ethics = countMatches(text, ETHICS_TERMS);
  const deployment = countMatches(text, DEPLOYMENT_TERMS);
  const score = (ai * 2) + (capability * 2) + (ethics * 3) + (deployment * 3);

  if (ai === 0) {
    return { applies: false, reason: 'no AI/workflow signal', score };
  }
  if (capability === 0) {
    return { applies: false, reason: 'no capability or decision signal', score };
  }
  if (ethics === 0 && deployment === 0) {
    return { applies: false, reason: 'no ethics, risk, deployment, or human-boundary signal', score };
  }
  if (score < 8) {
    return { applies: false, reason: 'weak decision-boundary signal', score };
  }

  const layer = deployment >= 3 || text.indexOf('production') !== -1 || text.indexOf('deploy') !== -1
    ? 'deployment-responsibility-boundary'
    : ethics >= 2 || text.indexOf('ethical') !== -1 || text.indexOf('harm') !== -1
      ? 'capability-vs-ethics-boundary'
      : 'lightweight-decision-boundary';

  return {
    applies: true,
    reason: 'AI decision work should separate capability evidence, ethics/risk, deployment ownership, and human support boundaries',
    score,
    layer,
    signals: { ai, capability, ethics, deployment }
  };
}

function decisionBoundaryPromptBlock(message) {
  const classification = classifyDecisionBoundary(message);
  if (!classification.applies) return '';

  return '[DECISION BOUNDARY CHECK]\n'
    + 'This looks like AI/agent decision work where capability, ethics, deployment, and human responsibility can get conflated. Before executing or shipping, split the layers explicitly.\n'
    + '- Capability evidence: what the model/system can actually do, with what source/tool/test evidence, and under which known limits.\n'
    + '- Ethics and risk judgment: what is allowed, harmful, biased, consent-sensitive, or policy-constrained even if technically possible.\n'
    + '- Deployment responsibility: who owns source choice, permissions, review, rollout, monitoring, rollback, and user-facing consequences.\n'
    + '- Human boundary: where a human must review, decide, support, or escalate instead of treating people as workflow inputs.\n'
    + '- Verification: name the smallest eval, audit trace, read-back, human review, or incident drill that proves the boundary holds.\n'
    + 'Keep this proportional; do not block harmless helpers, but do not hide high-stakes assumptions behind vague AI capability claims.\n'
    + '[/DECISION BOUNDARY CHECK]';
}

function appendDecisionBoundaryPrompt(message) {
  const block = decisionBoundaryPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyDecisionBoundary,
  decisionBoundaryPromptBlock,
  appendDecisionBoundaryPrompt
};
