'use strict';

// Deterministic tacit-knowledge capture nudge for automation/productization tasks.
// Inspired by Jake Van Clief's tacit judgment cluster: work becomes software only
// after repeated patterns are written down, but the remaining value often lives in
// examples, exceptions, taste, handoffs, and human review that generic automation misses.

const AUTOMATION_TERMS = [
  'automate', 'automation', 'agent', 'agents', 'ai', 'llm', 'model', 'workflow',
  'process', 'procedure', 'sop', 'playbook', 'template', 'system', 'dashboard',
  'intake', 'triage', 'handoff', 'orchestration', 'assistant'
];

const ROLE_WORK_TERMS = [
  'role', 'personality', 'persona', 'operator', 'manager', 'analyst', 'reviewer',
  'assistant', 'sales', 'support', 'finance', 'legal', 'security', 'cyber',
  'client', 'customer', 'user', 'team', 'department', 'position', 'job'
];

const TACIT_TERMS = [
  'judgment', 'judgement', 'taste', 'nuance', 'context', 'edge case', 'edge cases',
  'exception', 'exceptions', 'gut', 'intuition', 'preference', 'preferences',
  'examples', 'sample', 'samples', 'rubric', 'review', 'approval', 'quality',
  'know-how', 'tribal knowledge', 'unwritten'
];

const EXACT_TOOL_TERMS = [
  'checksum', 'hash', 'sha256', 'line count', 'syntax check', 'json parse',
  'schema validation', 'file exists', 'port open', 'disk usage', 'cpu usage'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyTacitCapture(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const automation = countMatches(text, AUTOMATION_TERMS);
  const roleWork = countMatches(text, ROLE_WORK_TERMS);
  const tacit = countMatches(text, TACIT_TERMS);
  const exact = countMatches(text, EXACT_TOOL_TERMS);
  const score = (automation * 2) + (roleWork * 2) + (tacit * 3) - (exact * 4);

  if (exact > 0 && tacit === 0) {
    return { applies: false, reason: 'deterministic tool check, not tacit work capture', score };
  }
  if (automation === 0) {
    return { applies: false, reason: 'no automation/workflow encoding signal', score };
  }
  if (roleWork === 0 && tacit === 0) {
    return { applies: false, reason: 'automation lacks role or tacit-judgment signal', score };
  }
  if (score < 8) {
    return { applies: false, reason: 'weak tacit-capture signal', score };
  }

  const layer = tacit >= 2
    ? 'tacit-judgment-capture'
    : roleWork >= 2
      ? 'role-workflow-capture'
      : 'written-process-capture';

  return {
    applies: true,
    reason: 'automation should separate written process from tacit judgment before productizing',
    score,
    layer,
    signals: { automation, roleWork, tacit, exact }
  };
}

function tacitCapturePromptBlock(message) {
  const classification = classifyTacitCapture(message);
  if (!classification.applies) return '';

  return '[TACIT-CAPTURE CHECK]\n'
    + 'This looks like role/workflow automation where some value may be unwritten judgment. Before building a generic agent or dashboard flow, separate what is already codified from what must be captured through examples and review.\n'
    + '- Written process: name the SOP, checklist, template, schema, prompt, or file that already describes the repeatable pattern.\n'
    + '- Tacit residue: name the judgment, taste, exception handling, client nuance, or operator preference that is not safely automated yet.\n'
    + '- Source examples: collect a few real inputs, desired outputs, counterexamples, and edge cases before claiming the workflow is encoded.\n'
    + '- Mechanism fit: use deterministic code for exact checks, a small classifier for bounded gates, generative AI for drafting/synthesis, and human review for unresolved judgment.\n'
    + '- Capture loop: save overrides, edits, approvals, and rejection reasons beside the source artifacts so repeated judgment can become a better written process later.\n'
    + 'Keep the automation claim sized to the evidence; augment the role before pretending to replace it.\n'
    + '[/TACIT-CAPTURE CHECK]';
}

function appendTacitCapturePrompt(message) {
  const block = tacitCapturePromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyTacitCapture,
  tacitCapturePromptBlock,
  appendTacitCapturePrompt
};