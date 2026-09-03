'use strict';

// Deterministic workflow-map nudge for team/process/memory work.
// Inspired by Jake Van Clief's "real Second Brain" lesson: useful AI memory is
// not a pile of sentences. It is a small map of nouns and verbs — actors,
// workflows, inputs, outputs, files, and relationships — that a fresh agent can
// navigate before it edits state or automates the wrong step.

const ACTOR_TERMS = [
  'team', 'teams', 'person', 'people', 'stakeholder', 'stakeholders', 'client',
  'clients', 'customer', 'customers', 'user', 'users', 'operator', 'operators',
  'role', 'roles', 'persona', 'personas', 'personality', 'agent', 'agents',
  'department', 'position', 'org', 'organization'
];

const WORKFLOW_TERMS = [
  'workflow', 'workflows', 'process', 'processes', 'handoff', 'handoffs',
  'intake', 'approval', 'review', 'routing', 'dispatch', 'pipeline', 'playbook',
  'runbook', 'procedure', 'automation', 'orchestration', 'task', 'tasks'
];

const MEMORY_TERMS = [
  'memory', 'second brain', 'knowledgebase', 'knowledge base', 'context',
  'docs', 'documents', 'files', 'folder', 'folders', 'workspace', 'workbench',
  'source of truth', 'notes', 'map', 'graph', 'index', 'catalog'
];

const IO_TERMS = [
  'input', 'inputs', 'output', 'outputs', 'artifact', 'artifacts', 'data',
  'source', 'sources', 'template', 'templates', 'brief', 'briefs', 'report',
  'reports', 'deliverable', 'deliverables'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyWorkflowMap(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const actors = countMatches(text, ACTOR_TERMS);
  const workflows = countMatches(text, WORKFLOW_TERMS);
  const memory = countMatches(text, MEMORY_TERMS);
  const io = countMatches(text, IO_TERMS);
  const score = (actors * 2) + (workflows * 2) + memory + io;

  if (score < 6 || (actors === 0 && workflows === 0)) {
    return { applies: false, reason: 'not team/workflow-memory shaped', score };
  }

  const layer = workflows >= 2 && io >= 2
    ? 'workflow-io-map'
    : memory >= 2
      ? 'position-addressed-memory-map'
      : 'actor-action-map';

  return {
    applies: true,
    reason: 'team/workflow work needs a noun/verb map before automation',
    score,
    layer,
    signals: { actors, workflows, memory, io }
  };
}

function workflowMapPromptBlock(message) {
  const classification = classifyWorkflowMap(message);
  if (!classification.applies) return '';

  return '[WORKFLOW-MAP CHECK]\n'
    + 'Before editing state or automating this work, sketch the smallest useful noun/verb map so the workflow is navigable rather than a pile of notes. Keep it proportional.\n'
    + '- Actors/nodes: name the people, roles, agents, teams, projects, data objects, and workspaces involved.\n'
    + '- Actions/edges: name who creates, consumes, approves, routes, reviews, updates, or depends on what.\n'
    + '- Inputs/outputs: identify the source inputs, produced artifacts, decision points, and handoff outputs.\n'
    + '- Source files/state: name the files, folders, database records, briefs, or logs that are source-of-truth versus generated scratch.\n'
    + '- Verification: show how a fresh agent/operator could follow the map without corrupting source state or guessing relationships.\n'
    + 'Do not turn this into a diagramming exercise unless the task asks for one; use it to prevent wrong abstractions.\n'
    + '[/WORKFLOW-MAP CHECK]';
}

function appendWorkflowMapPrompt(message) {
  const block = workflowMapPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyWorkflowMap,
  workflowMapPromptBlock,
  appendWorkflowMapPrompt
};
