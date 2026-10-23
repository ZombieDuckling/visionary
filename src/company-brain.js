'use strict';

// Deterministic company-brain nudge for requests that encode an organization's
// operational reality — building a knowledge base, second brain, internal wiki,
// onboarding docs, or an internal assistant meant to answer "what should I do
// now?". Inspired by Jake Van Clief's company-brain lesson (video D1ds32wBoDk,
// concept company-brain-context-packages): a company brain is a connectable
// context package — responsibility map + SOPs + request routing + query surface
// + correction loop + permission boundary — that an agent navigates, not a chat
// window over loose documents. The failure modes are stopping at "ask questions
// in a chat" with no encoded roles/ownership, replacing managers without moving
// the coordination rules into the system, a stale brain with no correction loop,
// and open permissions that leak sensitive operational context.
//
// This is distinct from the workflow-skill-template nudge (a single portable
// skill/SOP) and the scoped-memory-routing nudge (one preference's destination):
// this nudge fires on *org-scoped, navigable* knowledge — roles, ownership,
// escalation, routing, approvals, and permissions — that other people or agents
// are meant to traverse. Visionary's own workbench (roles, ownership, SOPs,
// routing, implementation ledger) is the local-scale instance of the pattern.

const EXPLICIT_BRAIN_TERMS = [
  'company brain', 'company-brain', 'second brain', 'knowledge base', 'knowledgebase',
  'knowledge-base', 'context package', 'company knowledge', 'org knowledge',
  'organization knowledge', 'organisation knowledge', 'company wiki', 'internal wiki',
  'internal knowledge', 'knowledge hub', 'company memory', 'org memory',
  'organization memory', 'internal assistant', 'employee assistant', 'team assistant',
  'company assistant', 'documentation hub', 'docs hub', 'company second brain'
];

const ORG_TERMS = [
  'team', 'company', 'organisation', 'organization', 'business', 'department',
  'employees', 'employee', 'staff', 'internal', 'onboarding', 'new hire', 'new hires',
  'manager', 'managers', 'colleagues', 'clients', 'client', 'stakeholders', 'company-wide'
];

const ROUTING_TERMS = [
  'route', 'routing', 'what should i do', 'what to do next', 'navigate', 'queryable',
  'lookup', 'look up', 'ask the', 'tell people', 'point people', 'answer questions',
  'escalat', 'who owns', 'ownership', 'permission', 'approval', 'handbook',
  'find the right', 'who to ask'
];

const NAMED_PACKAGE_TERMS = [
  'responsibility map', 'ownership map', 'escalation path', 'routing rules',
  'request routing', 'query surface', 'allowed tools', 'correction loop',
  'memory loop', 'update loop', 'review loop', 'approval rules',
  'permission boundary', 'provenance', 'telemetry', 'hand over the loop',
  'org chart', 'sop', 'sops', 'playbook'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyCompanyBrain(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const explicit = countMatches(text, EXPLICIT_BRAIN_TERMS);
  const org = countMatches(text, ORG_TERMS);
  const routing = countMatches(text, ROUTING_TERMS);
  const named = countMatches(text, NAMED_PACKAGE_TERMS);

  if (explicit === 0 && !(org >= 1 && routing >= 1)) {
    return { applies: false, reason: 'not an org-knowledge/routing request', score: org + routing };
  }
  if (named >= 2) {
    return { applies: false, reason: 'company-brain package already named', score: explicit + org + routing };
  }

  const layer = explicit >= 1
    ? 'explicit-company-brain'
    : 'implied-company-brain';

  return {
    applies: true,
    reason: 'org-scoped knowledge is being built; name the responsibility map, SOPs, routing, query surface, correction loop, and permission boundary before calling it a company brain',
    score: explicit * 2 + org + routing,
    layer,
    signals: { explicit: explicit, org: org, routing: routing, named: named }
  };
}

function companyBrainPromptBlock(message) {
  const classification = classifyCompanyBrain(message);
  if (!classification.applies) return '';

  return '[COMPANY-BRAIN CHECK]\n'
    + 'This request encodes an organization\'s operational reality so people or agents can navigate it. A company brain is a connectable context package — responsibility map + SOPs + routing + query surface + correction loop + permission boundary — not a chat window over loose documents. Before building, name each part briefly:\n'
    + '- Responsibility map: org chart, who manages/owns what, and the escalation paths.\n'
    + '- SOPs / playbooks: the encoded "what to do" for common requests, not tribal knowledge.\n'
    + '- Request routing + approval: what goes where, who approves, and the thresholds behind each decision.\n'
    + '- Query surface: the navigation layer and its allowed tools/permissions — how a person asks "what should I do now?" and receives a routed answer instead of a text search.\n'
    + '- Correction / memory loop: how the brain is corrected as people operate against it, so encoded SOPs cannot drift into stale guidance.\n'
    + '- Permission / provenance boundary: who can read or write what, and where each fact came from, so sensitive operational context does not leak.\n'
    + '- Review / telemetry: logs, approvals, and failure handling for the routing decisions.\n'
    + '- Hand over the loop: build the system that manages, then hand the maintenance loop to the org — management becomes infrastructure, not relayed human instruction.\n'
    + '- Failure mode: stopping at "ask questions in a chat" with no encoded roles/ownership/SOPs, replacing managers without moving the coordination rules in, a stale brain with no correction loop, or open permissions.\n'
    + '- Verdict: a real company-brain package (org-scoped, queryable, routable, bounded) or just a loose docs folder.\n'
    + '[/COMPANY-BRAIN CHECK]';
}

function appendCompanyBrainPrompt(message) {
  const block = companyBrainPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyCompanyBrain,
  companyBrainPromptBlock,
  appendCompanyBrainPrompt
};
