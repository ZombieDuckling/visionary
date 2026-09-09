'use strict';

// Deterministic paid-pain/opportunity-routing nudge for market, client, and
// workflow build requests. Inspired by Jake Van Clief's repeated lesson that AI
// products should start from where money/time already moves, then package the
// smallest workflow surface that routes demand to capable fulfillment.

const DEMAND_TERMS = [
  'client', 'clients', 'customer', 'customers', 'buyer', 'buyers', 'user', 'users',
  'market', 'community', 'lead', 'leads', 'sales', 'prospect', 'prospects',
  'paid', 'paying', 'revenue', 'money', 'budget', 'roi', 'opportunity', 'demand'
];

const PAIN_TERMS = [
  'pain', 'problem', 'problems', 'bottleneck', 'manual', 'overflow', 'backlog',
  'time sink', 'waste', 'expensive', 'cost', 'costly', 'slow', 'repetitive',
  'friction', 'support', 'requests', 'inbound', 'intake'
];

const BUILD_TERMS = [
  'build', 'design', 'create', 'launch', 'ship', 'validate', 'prototype',
  'automate', 'route', 'package', 'turn into', 'workflow', 'dashboard',
  'platform', 'marketplace', 'service', 'agent', 'automation', 'feature'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyOpportunityRouting(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const demandMatches = countMatches(text, DEMAND_TERMS);
  const painMatches = countMatches(text, PAIN_TERMS);
  const buildMatches = countMatches(text, BUILD_TERMS);
  const score = (demandMatches * 2) + (painMatches * 2) + buildMatches;

  if (score < 6 || (demandMatches === 0 && painMatches === 0)) {
    return { applies: false, reason: 'no paid-pain/opportunity routing signal', score };
  }

  const layer = demandMatches >= 2 && painMatches >= 1
    ? 'paid-pain-intake'
    : buildMatches >= 2
      ? 'opportunity-to-workflow'
      : 'market-signal-check';

  return {
    applies: true,
    reason: 'market/client workflow should prove paid pain before buildout',
    score,
    layer,
    signals: {
      demand: demandMatches,
      pain: painMatches,
      build: buildMatches
    }
  };
}

function opportunityRoutingPromptBlock(message) {
  const classification = classifyOpportunityRouting(message);
  if (!classification.applies) return '';

  return '[OPPORTUNITY-ROUTING CHECK]\n'
    + 'Before recommending or building the workflow, anchor it to paid pain instead of AI novelty. Keep this brief and then complete the requested work.\n'
    + '- Buyer/user: who has the problem, who pays or approves, and who fulfills the work?\n'
    + '- Current cost: what time, money, backlog, risk, or opportunity cost already exists?\n'
    + '- Capacity and routing: what demand source, intake signal, operator/agent role, and handoff path make fulfillment possible?\n'
    + '- Reusable asset: what checklist, template, brief, dataset, script, or workbench should be saved so the next job is cheaper?\n'
    + '- Proof-of-work: what small artifact or measurable outcome proves value before broader product buildout?\n'
    + '[/OPPORTUNITY-ROUTING CHECK]';
}

function appendOpportunityRoutingPrompt(message) {
  const block = opportunityRoutingPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyOpportunityRouting,
  opportunityRoutingPromptBlock,
  appendOpportunityRoutingPrompt
};
