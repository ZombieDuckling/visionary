'use strict';

// Deterministic domain-expert-source nudge for workflows where generic AI
// capability is not enough. Inspired by Jake Van Clief's lesson that subject
// experts beat AI experts: before automating real estate, finance, legal,
// healthcare, security, education, operations, or customer workflows, agents
// should anchor the build in practitioner artifacts, edge cases, and sign-off.

const DOMAIN_TERMS = [
  'real estate', 'lease', 'leases', 'broker', 'brokerage', 'property', 'investor',
  'accounting', 'finance', 'financial', 'investment', 'portfolio', 'tax', 'legal',
  'contract', 'compliance', 'medical', 'healthcare', 'clinical', 'insurance',
  'claims', 'education', 'school', 'teacher', 'student', 'cyber', 'security',
  'incident', 'sales', 'support', 'customer', 'client', 'operations', 'ops',
  'manufacturing', 'logistics', 'construction', 'recruiting', 'hr'
];

const AI_BUILD_TERMS = [
  'ai', 'agent', 'agents', 'assistant', 'automation', 'automate', 'workflow',
  'tool', 'dashboard', 'system', 'platform', 'bot', 'copilot', 'classifier',
  'triage', 'recommendation', 'reporting', 'intake', 'outreach', 'review',
  'build', 'design', 'create', 'ship', 'implement', 'prototype'
];

const EXPERT_TERMS = [
  'domain expert', 'subject expert', 'sme', 'practitioner', 'expert', 'reviewer',
  'rubric', 'acceptance criteria', 'edge case', 'source material', 'example',
  'anti-example', 'sign off', 'sign-off', 'approve', 'approval'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyDomainExpertSource(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const domainMatches = countMatches(text, DOMAIN_TERMS);
  const buildMatches = countMatches(text, AI_BUILD_TERMS);
  const expertMatches = countMatches(text, EXPERT_TERMS);
  const score = (domainMatches * 2) + (buildMatches * 2) + (expertMatches * 3);

  if (domainMatches === 0 || buildMatches === 0) {
    return { applies: false, reason: 'no domain-specific AI/build workflow signal', score };
  }
  if (score < 7) {
    return { applies: false, reason: 'weak domain-expert source signal', score };
  }

  const layer = expertMatches > 0
    ? 'expert-source-required'
    : domainMatches >= 2 && buildMatches >= 2
      ? 'domain-workflow-build'
      : 'domain-artifact-check';

  return {
    applies: true,
    reason: 'domain workflow needs practitioner source material before AI design',
    score,
    layer,
    signals: {
      domain: domainMatches,
      build: buildMatches,
      expert: expertMatches
    }
  };
}

function domainExpertSourcePromptBlock(message) {
  const classification = classifyDomainExpertSource(message);
  if (!classification.applies) return '';

  return '[DOMAIN-EXPERT SOURCE CHECK]\n'
    + 'This looks like a domain-specific workflow. Do not substitute generic AI fluency for practitioner judgment. Before designing or automating, anchor the work in real domain evidence and then complete the requested task.\n'
    + '- Domain owner: name the practitioner, reviewer, or accountable role whose judgment the workflow must preserve.\n'
    + '- Source artifacts: identify the leases, reports, tickets, calls, policies, examples, datasets, or existing work products that define reality.\n'
    + '- Edge cases: list at least one failure mode, anti-example, compliance/business constraint, or local-context rule the automation must respect.\n'
    + '- Use boundaries: separate AI-assist, human-review, and human-only/no-use parts of the workflow.\n'
    + '- Acceptance: define the domain-specific rubric or sign-off needed before recurring automation or agent autonomy expands.\n'
    + 'Keep this concise; use it to improve the deliverable, not to stall execution.\n'
    + '[/DOMAIN-EXPERT SOURCE CHECK]';
}

function appendDomainExpertSourcePrompt(message) {
  const block = domainExpertSourcePromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyDomainExpertSource,
  domainExpertSourcePromptBlock,
  appendDomainExpertSourcePrompt
};
