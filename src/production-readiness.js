'use strict';

// Production-readiness helpers for deciding whether an AI workflow is still a
// demo, an internal prototype, or ready for higher-trust operation.
//
// The design is deliberately deterministic: Visionary should classify and gate
// workflows with plain code before asking agents to improvise judgment.

const WORKFLOW_TYPES = ['deterministic', 'llm_call', 'agentic'];
const RISK_LEVELS = ['low', 'medium', 'high'];

const BASE_GATES = [
  { id: 'owner', label: 'Named owner', required: true },
  { id: 'rollback', label: 'Rollback / recovery path', required: true },
  { id: 'audit_log', label: 'Audit trail of inputs, tools, outputs, and human overrides', required: true },
  { id: 'monitoring', label: 'Monitoring / stale-run visibility', required: true },
  { id: 'cost_budget', label: 'Token/cost budget or BYO-key boundary', required: true },
  { id: 'secret_boundary', label: 'Secrets kept outside mutable workspace files', required: true },
  { id: 'data_boundary', label: 'Allowed data/classes/providers documented', required: true },
  { id: 'evals', label: 'Validation/eval checks for expected outputs', required: true },
];

const AGENTIC_GATES = [
  { id: 'tool_allowlist', label: 'Tool/action allowlist', required: true },
  { id: 'risk_envelope', label: 'Risk envelope and autonomy limits', required: true },
  { id: 'human_review', label: 'Human review or approval point for risky actions', required: true },
  { id: 'retry_policy', label: 'Retry/failover policy with stop condition', required: true },
];

const HIGH_RISK_GATES = [
  { id: 'access_control', label: 'Access control / permission model', required: true },
  { id: 'incident_path', label: 'Incident reporting and containment path', required: true },
];

const TRUTH_DECK_CASE_FIELDS = [
  'input',
  'expected_output',
  'must_include',
  'must_avoid',
  'quality_threshold',
];

function cleanString(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeWorkflowType(type) {
  const normalized = cleanString(type).toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'script' || normalized === 'rule' || normalized === 'rules') return 'deterministic';
  if (normalized === 'llm' || normalized === 'one_shot_llm' || normalized === 'summarization') return 'llm_call';
  if (normalized === 'agent' || normalized === 'autonomous' || normalized === 'tool_using') return 'agentic';
  return WORKFLOW_TYPES.includes(normalized) ? normalized : 'agentic';
}

function normalizeRiskLevel(level) {
  const normalized = cleanString(level).toLowerCase();
  return RISK_LEVELS.includes(normalized) ? normalized : 'medium';
}

function classifyWorkflow(input) {
  const text = [
    input && input.type,
    input && input.description,
    input && input.prompt,
    input && input.notes,
  ].map(cleanString).join(' ').toLowerCase();

  if (input && input.type) return normalizeWorkflowType(input.type);

  const toolWords = ['tool', 'dispatch', 'write', 'edit', 'delete', 'browser', 'shell', 'terminal', 'api', 'retry', 'decide', 'choose'];
  if (toolWords.some((word) => text.includes(word))) return 'agentic';
  if (text.includes('summarize') || text.includes('extract') || text.includes('rewrite') || text.includes('classify')) return 'llm_call';
  return 'deterministic';
}

function requiredGatesFor(input) {
  const workflowType = classifyWorkflow(input || {});
  const riskLevel = normalizeRiskLevel(input && input.risk);
  const gates = BASE_GATES.slice();
  if (workflowType === 'agentic') gates.push(...AGENTIC_GATES);
  if (riskLevel === 'high') gates.push(...HIGH_RISK_GATES);
  return { workflowType, riskLevel, gates };
}

function hasText(value) {
  if (Array.isArray(value)) return value.some((item) => hasText(item));
  return cleanString(value).length > 0;
}

function validateTruthDeck(deck) {
  const missing = [];
  const normalized = deck && typeof deck === 'object' ? deck : {};
  if (!hasText(normalized.goal)) missing.push('goal');

  const cases = Array.isArray(normalized.cases) ? normalized.cases : [];
  if (cases.length === 0) {
    missing.push('cases');
  }

  const case_results = cases.map((truthCase, index) => {
    const caseMissing = [];
    const item = truthCase && typeof truthCase === 'object' ? truthCase : {};
    if (!hasText(item.name)) caseMissing.push('name');
    for (const field of TRUTH_DECK_CASE_FIELDS) {
      if (!hasText(item[field])) caseMissing.push(field);
    }
    return {
      index,
      name: cleanString(item.name) || 'Case ' + (index + 1),
      ready: caseMissing.length === 0,
      missing_fields: caseMissing,
    };
  });

  const failedCases = case_results.filter((result) => !result.ready);
  if (failedCases.length > 0) missing.push('complete_cases');

  const ready = missing.length === 0;
  return {
    ready,
    stage: ready ? 'truth_deck_ready' : 'truth_deck_incomplete',
    required_case_fields: ['name', ...TRUTH_DECK_CASE_FIELDS],
    missing_fields: missing,
    case_results,
    summary: ready
      ? 'Truth deck has a goal and complete representative cases.'
      : 'Truth deck missing: ' + missing.join(', '),
  };
}

function readinessReview(input) {
  const provided = new Set((input && input.gates_done) || []);
  const truthDeckReview = input && input.truth_deck ? validateTruthDeck(input.truth_deck) : null;
  if (truthDeckReview && truthDeckReview.ready) provided.add('evals');
  const { workflowType, riskLevel, gates } = requiredGatesFor(input || {});
  const missing = gates.filter((gate) => gate.required && !provided.has(gate.id));
  const ready = missing.length === 0;
  return {
    ready,
    stage: ready ? 'production_candidate' : 'prototype',
    workflow_type: workflowType,
    risk_level: riskLevel,
    required_gates: gates,
    missing_gates: missing,
    truth_deck: truthDeckReview,
    summary: ready
      ? 'All required production-readiness gates are satisfied.'
      : missing.length + ' production-readiness gate(s) missing: ' + missing.map((g) => g.id).join(', '),
  };
}

module.exports = {
  WORKFLOW_TYPES,
  RISK_LEVELS,
  BASE_GATES,
  AGENTIC_GATES,
  HIGH_RISK_GATES,
  TRUTH_DECK_CASE_FIELDS,
  classifyWorkflow,
  requiredGatesFor,
  validateTruthDeck,
  readinessReview,
};
