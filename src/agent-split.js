'use strict';

// Deterministic agent/persona split nudge for org/role design work.
// Inspired by Jake Van Clief's warning that extra agents often hide weak
// information architecture. Distinct agents are useful when they provide real
// isolation, ownership, tool scope, watchdog behavior, or review boundaries —
// not when a smaller router/workbench/context layer would do.

const AGENT_TERMS = [
  'agent', 'agents', 'assistant', 'assistants', 'bot', 'bots', 'persona',
  'personas', 'personality', 'personalities', 'role', 'roles', 'org chart',
  'organization', 'team', 'teams', 'department', 'departments', 'director',
  'worker', 'workers', 'specialist', 'specialists'
];

const SPLIT_TERMS = [
  'create', 'build', 'design', 'map', 'add', 'spawn', 'assign', 'route',
  'dispatch', 'orchestrate', 'delegate', 'specialize', 'split', 'separate',
  'handoff', 'own', 'review', 'approve'
];

const WORKBENCH_TERMS = [
  'workflow', 'workflows', 'process', 'processes', 'workspace', 'workbench',
  'folder', 'folders', 'context', 'memory', 'knowledgebase', 'knowledge base',
  'routing', 'router', 'tool', 'tools', 'permission', 'permissions', 'cost',
  'token', 'tokens', 'watchdog', 'governance'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyAgentSplit(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const agents = countMatches(text, AGENT_TERMS);
  const splits = countMatches(text, SPLIT_TERMS);
  const workbench = countMatches(text, WORKBENCH_TERMS);
  const score = (agents * 2) + splits + workbench;

  if (agents === 0 || splits === 0 || score < 5) {
    return { applies: false, reason: 'not agent/persona split shaped', score };
  }

  const layer = workbench >= 3
    ? 'workbench-before-agent-split'
    : agents >= 3
      ? 'multi-agent-role-split'
      : 'single-agent-role-check';

  return {
    applies: true,
    reason: 'agent/persona requests need split justification before adding roles',
    score,
    layer,
    signals: { agents, splits, workbench }
  };
}

function agentSplitPromptBlock(message) {
  const classification = classifyAgentSplit(message);
  if (!classification.applies) return '';

  return '[AGENT-SPLIT CHECK]\n'
    + 'Before adding or routing more agents/personas, justify the split. Extra agents are not a substitute for clear workbench/context architecture. Keep this brief and then continue the task.\n'
    + '- Needed boundary: name what requires a distinct agent — separate authority, ownership, tool access, secrets, watchdog cadence, review duty, cost/latency profile, or user-facing identity.\n'
    + '- Simpler layer: state whether a folder/workbench, routing file, template, checklist, deterministic script, or one strong model with better context would solve it instead.\n'
    + '- Role contract: for every kept agent/persona, name its inputs, outputs, allowed actions/tools, escalation/review path, and success signal.\n'
    + '- Consolidation rule: merge roles that only differ by tone or duplicated prompts; split only when isolation or accountability improves reliability.\n'
    + '[/AGENT-SPLIT CHECK]';
}

function appendAgentSplitPrompt(message) {
  const block = agentSplitPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyAgentSplit,
  agentSplitPromptBlock,
  appendAgentSplitPrompt
};
