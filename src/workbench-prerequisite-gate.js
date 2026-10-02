'use strict';

// Deterministic prerequisite-gate nudge for agent/workflow requests that skip
// the boring inputs needed for the visible AI layer to work. Inspired by Jake
// Van Clief's agent-UX lesson: an "agent" label is not the product; useful work
// depends on procedure, role context, source/connector access, permissions, and
// cost/review limits being named before dispatch.

const AI_AGENT_TERMS = [
  'agent', 'agents', 'assistant', 'copilot', 'ai', 'llm', 'bot', 'automation',
  'automate', 'workflow', 'orchestrate', 'dispatch', 'routed', 'router'
];

const WORK_TERMS = [
  'email', 'inbox', 'calendar', 'crm', 'support', 'sales', 'lead', 'client',
  'customer', 'research', 'report', 'dashboard', 'project', 'task', 'tasks',
  'ticket', 'tickets', 'repo', 'repository', 'codebase', 'docs', 'files'
];

const PREREQ_TERMS = [
  'skill', 'procedure', 'sop', 'playbook', 'checklist', 'role', 'context',
  'source', 'sources', 'connector', 'connectors', 'permission', 'permissions',
  'credential', 'credentials', 'secret', 'secrets', 'read-back', 'read back',
  'verify', 'verification', 'cost', 'budget', 'limit', 'limits', 'token', 'tokens',
  'governance', 'audit', 'review'
];

const UI_ONLY_TERMS = [
  'rename', 'label', 'icon', 'color', 'badge', 'avatar', 'persona name', 'theme'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyWorkbenchPrerequisiteGate(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const aiAgent = countMatches(text, AI_AGENT_TERMS);
  const work = countMatches(text, WORK_TERMS);
  const prereq = countMatches(text, PREREQ_TERMS);
  const uiOnly = countMatches(text, UI_ONLY_TERMS);
  const score = (aiAgent * 3) + (work * 2) + (prereq * 2) - (uiOnly * 3);

  if (uiOnly > 0 && work === 0 && prereq === 0) {
    return { applies: false, reason: 'cosmetic agent UI request, not workflow prerequisites', score };
  }
  if (aiAgent === 0) {
    return { applies: false, reason: 'no agent/workflow automation signal', score };
  }
  if (work === 0 && prereq < 2) {
    return { applies: false, reason: 'agent request lacks concrete work or prerequisite signal', score };
  }
  if (score < 9) {
    return { applies: false, reason: 'weak prerequisite-gate signal', score };
  }

  const layer = prereq >= 4
    ? 'explicit-prerequisite-contract'
    : work >= 3
      ? 'work-context-prerequisite-gate'
      : 'agent-action-prerequisite-gate';

  return {
    applies: true,
    reason: 'agent/workflow request needs prerequisites before action',
    score,
    layer,
    signals: { aiAgent, work, prereq, uiOnly }
  };
}

function workbenchPrerequisiteGatePromptBlock(message) {
  const classification = classifyWorkbenchPrerequisiteGate(message);
  if (!classification.applies) return '';

  return '[WORKBENCH-PREREQUISITE GATE]\n'
    + 'This looks like an agent/workflow automation request. Before treating the agent label as the solution, name the prerequisites that make the work executable and auditable.\n'
    + '- Procedure/skill: what SOP, checklist, playbook, or task skill defines the expected action?\n'
    + '- Role/user context: whose workflow is this for, what authority does the agent have, and what constraints/preferences matter?\n'
    + '- Source and connector access: what files, systems, APIs, inboxes, repos, or databases are required, and which are read-only versus writable?\n'
    + '- Permission/read-back boundary: what approvals, secret isolation, sandboxing, and read-back checks prove the action happened safely?\n'
    + '- Cost/governance limit: what token, budget, rate, retry, audit, or human-review limit prevents the workflow from becoming expensive or ungoverned?\n'
    + 'If a plain folder/workbench plus routed model satisfies the job, prefer that over inventing another agent.\n'
    + '[/WORKBENCH-PREREQUISITE GATE]';
}

function appendWorkbenchPrerequisiteGatePrompt(message) {
  const block = workbenchPrerequisiteGatePromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyWorkbenchPrerequisiteGate,
  workbenchPrerequisiteGatePromptBlock,
  appendWorkbenchPrerequisiteGatePrompt
};
