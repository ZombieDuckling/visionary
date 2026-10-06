'use strict';

// Deterministic execution-evidence nudge for automation/status workflows.
// Inspired by Jake Van Clief's warning that "running" or "green" only proves
// nothing crashed: useful automations need inspectable outputs, cheap checks,
// and human gates before downstream work trusts the result.

const AUTOMATION_TERMS = [
  'ai', 'agent', 'automation', 'workflow', 'pipeline', 'job', 'cron', 'scheduler',
  'scheduled', 'script', 'report', 'dashboard', 'integration', 'dispatch'
];

const STATUS_TERMS = [
  'running', 'green', 'success', 'successful', 'passed', 'complete', 'completed',
  'done', 'healthy', 'ok', 'ready', 'finished', 'no errors', 'not crashed'
];

const EVIDENCE_TERMS = [
  'report', 'artifact', 'artifacts', 'output', 'outputs', 'file', 'files',
  'manifest', 'log', 'logs', 'checks', 'check', 'validate', 'validation',
  'verify', 'verification', 'freshness', 'correct', 'wrong', 'accuracy',
  'human gate', 'approval', 'review', 'downstream', 'external'
];

const EXISTING_GATE_TERMS = [
  'per-step artifact', 'one-minute check', 'human gate', 'read-back',
  'acceptance criteria', 'status is not correctness', 'artifact verification'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyExecutionEvidenceGate(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const automation = countMatches(text, AUTOMATION_TERMS);
  const status = countMatches(text, STATUS_TERMS);
  const evidence = countMatches(text, EVIDENCE_TERMS);
  const existingGate = countMatches(text, EXISTING_GATE_TERMS);
  const score = (automation * 2) + (status * 3) + (evidence * 2) - (existingGate * 3);

  if (automation === 0) {
    return { applies: false, reason: 'no automation/workflow signal', score };
  }
  if (status === 0) {
    return { applies: false, reason: 'no status-trust signal', score };
  }
  if (evidence < 2) {
    return { applies: false, reason: 'no artifact/check risk signal', score };
  }
  if (existingGate >= 2) {
    return { applies: false, reason: 'operator already supplied evidence gate', score };
  }
  if (score < 8) {
    return { applies: false, reason: 'weak execution-evidence signal', score };
  }

  const layer = text.indexOf('downstream') !== -1 || text.indexOf('external') !== -1 || text.indexOf('approval') !== -1
    ? 'human-gated-downstream-use'
    : evidence >= 4
      ? 'artifact-verification'
      : 'status-correctness-check';

  return {
    applies: true,
    reason: 'automation status needs artifact-backed correctness checks',
    score,
    layer,
    signals: { automation, status, evidence, existingGate }
  };
}

function executionEvidenceGatePromptBlock(message) {
  const classification = classifyExecutionEvidenceGate(message);
  if (!classification.applies) return '';

  return '[EXECUTION EVIDENCE CHECK]\n'
    + 'This looks like an automation/status workflow where green, running, or completed state could be mistaken for correct output. Before downstream use, prove the work with inspectable evidence.\n'
    + '- Expected artifact: name the concrete report/file/table/log/manifest that should exist after each meaningful step.\n'
    + '- Cheap checks: include one-minute freshness, count, schema, sample, link, or spot checks that catch wrong-but-running output.\n'
    + '- Status boundary: separate process health from result correctness; say what “running” proves and what it does not prove.\n'
    + '- Human gate: name where a person reviews the artifact before external delivery, customer impact, money/security decisions, or downstream automation.\n'
    + '- Safe stop: if the artifact/check is missing or wrong, stop or degrade honestly instead of forwarding stale or fabricated output.\n'
    + 'Keep this proportional and then deliver the requested work.\n'
    + '[/EXECUTION EVIDENCE CHECK]';
}

function appendExecutionEvidenceGatePrompt(message) {
  const block = executionEvidenceGatePromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyExecutionEvidenceGate,
  executionEvidenceGatePromptBlock,
  appendExecutionEvidenceGatePrompt
};
