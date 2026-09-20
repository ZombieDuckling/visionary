'use strict';

// Deterministic replicability nudge for dispatches that ask an agent to ship,
// deploy, automate, or operate something others will need to repeat. Inspired by
// Jake Van Clief's redundancy/replicability lesson: useful agent work should
// leave enough inputs, commands, fallbacks, and proof that the next run can be
// reproduced without the original chat context.

const DELIVERY_TERMS = [
  'ship', 'deploy', 'launch', 'release', 'publish', 'install', 'setup', 'set up',
  'configure', 'automation', 'automate', 'workflow', 'pipeline', 'runbook',
  'cron', 'scheduled', 'production', 'ops', 'operate', 'handoff'
];

const REPLICATION_TERMS = [
  'repeat', 'repeatable', 'replicate', 'replicable', 'reproduce', 'reproducible',
  'rerun', 're-run', 'again', 'same result', 'standardize', 'standardise',
  'template', 'checklist', 'sop', 'playbook', 'backup', 'fallback', 'redundancy',
  'redundant', 'recover', 'restore'
];

const PROOF_TERMS = [
  'verify', 'test', 'smoke', 'check', 'validate', 'evidence', 'proof', 'logs',
  'artifact', 'artifacts', 'command', 'commands', 'environment', 'env', 'version',
  'versions', 'dependency', 'dependencies'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyReplicabilityCheck(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const deliveryMatches = countMatches(text, DELIVERY_TERMS);
  const replicationMatches = countMatches(text, REPLICATION_TERMS);
  const proofMatches = countMatches(text, PROOF_TERMS);
  const score = (deliveryMatches * 2) + (replicationMatches * 3) + proofMatches;

  if (deliveryMatches === 0) {
    return { applies: false, reason: 'no delivery/ops signal', score };
  }
  if (replicationMatches === 0 && proofMatches < 2) {
    return { applies: false, reason: 'no replicability/proof signal', score };
  }
  if (score < 6) {
    return { applies: false, reason: 'weak replicability signal', score };
  }

  const layer = replicationMatches >= 2 || text.indexOf('runbook') !== -1 || text.indexOf('playbook') !== -1
    ? 'repeatable-runbook'
    : proofMatches >= 3
      ? 'evidence-backed-handoff'
      : 'operational-redundancy';

  return {
    applies: true,
    reason: 'delivery work should leave repeatable steps and fallback proof',
    score,
    layer,
    signals: {
      delivery: deliveryMatches,
      replication: replicationMatches,
      proof: proofMatches
    }
  };
}

function replicabilityCheckPromptBlock(message) {
  const classification = classifyReplicabilityCheck(message);
  if (!classification.applies) return '';

  return '[REPLICABILITY CHECK]\n'
    + 'This looks like delivery/ops work that may need to run again. Before finishing, leave enough structure that the next operator or agent can reproduce it without this chat.\n'
    + '- Inputs and environment: name the source files, data, credentials boundary, versions, and assumptions required to rerun safely.\n'
    + '- Repeatable path: capture the exact commands, scripts, checklist, or runbook steps that produce the result.\n'
    + '- Redundancy and fallback: name the backup path if the preferred runtime, provider, service, or dependency fails.\n'
    + '- Proof: save or report the verification command/output and the artifact/location that proves the run worked.\n'
    + 'Keep it proportional; do not turn a tiny task into process theater, but do not ship a one-off that cannot be repeated.\n'
    + '[/REPLICABILITY CHECK]';
}

function appendReplicabilityCheckPrompt(message) {
  const block = replicabilityCheckPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyReplicabilityCheck,
  replicabilityCheckPromptBlock,
  appendReplicabilityCheckPrompt
};
