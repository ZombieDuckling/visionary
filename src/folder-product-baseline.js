'use strict';

// Deterministic folder-product baseline nudge for product/app/agent build
// requests. Inspired by Jake Van Clief's "Just the folders bro" lesson: before
// turning a workflow into custom software, prove whether a routed folder,
// markdown context, durable artifacts, and a strong model solve the job. Build
// Visionary-specific infrastructure only where the folder lacks deployment,
// governance, permissions, collaboration, continuity, or operator visibility.

const BUILD_TERMS = [
  'build', 'create', 'make', 'ship', 'prototype', 'mvp', 'app', 'dashboard',
  'platform', 'tool', 'software', 'system', 'workflow', 'automation', 'portal',
  'frontend', 'front end', 'interface', 'ui', 'ux', 'feature', 'saas'
];

const AI_OR_WORKFLOW_TERMS = [
  'agent', 'agents', 'ai', 'llm', 'model', 'prompt', 'prompts', 'persona',
  'personality', 'role', 'roles', 'orchestration', 'kanban', 'workbench',
  'workspace', 'knowledgebase', 'memory', 'context', 'routing', 'markdown',
  'folder', 'folders', 'files', 'docs', 'documents'
];

const DEPLOYMENT_TERMS = [
  'team', 'teams', 'shared', 'collaborative', 'collaboration', 'multiplayer',
  'client', 'clients', 'user', 'users', 'permission', 'permissions', 'privacy',
  'secret', 'secrets', 'audit', 'review', 'approval', 'history', 'version',
  'versions', 'handoff', 'continuity', 'artifact', 'artifacts', 'sync', 'deploy'
];

const CLEAR_SOFTWARE_TERMS = [
  'api', 'database', 'sqlite', 'auth', 'login', 'server', 'endpoint', 'webhook',
  'scheduler', 'cron', 'sse', 'websocket', 'integration', 'integrations'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyFolderProductBaseline(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const buildMatches = countMatches(text, BUILD_TERMS);
  const workflowMatches = countMatches(text, AI_OR_WORKFLOW_TERMS);
  const deploymentMatches = countMatches(text, DEPLOYMENT_TERMS);
  const softwareMatches = countMatches(text, CLEAR_SOFTWARE_TERMS);
  const score = (buildMatches * 2) + (workflowMatches * 2) + deploymentMatches + softwareMatches;

  if (buildMatches === 0 || workflowMatches === 0) {
    return { applies: false, reason: 'not product/workbench build shaped', score };
  }
  if (score < 7) {
    return { applies: false, reason: 'weak folder-product signal', score };
  }

  const layer = deploymentMatches >= 2
    ? 'deployment-and-governance-layer'
    : softwareMatches >= 2
      ? 'software-after-folder-baseline'
      : 'folder-workbench-baseline';

  return {
    applies: true,
    reason: 'product build should be tested against folder/workbench baseline first',
    score,
    layer,
    signals: {
      build: buildMatches,
      workflow: workflowMatches,
      deployment: deploymentMatches,
      software: softwareMatches
    }
  };
}

function folderProductBaselinePromptBlock(message) {
  const classification = classifyFolderProductBaseline(message);
  if (!classification.applies) return '';

  return '[FOLDER-PRODUCT BASELINE CHECK]\n'
    + 'Before building more app/agent infrastructure, test the cheap baseline: could a well-routed folder/workbench plus markdown context, files, tools, and a strong model solve this?\n'
    + '- Folder baseline: name the smallest folder/files/router/context/artifact setup that would solve the operator job without custom software.\n'
    + '- Product gap: if software is still needed, name the specific gap the folder cannot cover: roles, permissions, privacy, shared access, continuity, audit, artifact visibility, integrations, scheduling, or live status.\n'
    + '- Build boundary: implement only the smallest layer that captures that gap; do not rebuild what plain files and markdown already handle.\n'
    + '- Verification: include how a fresh agent/user would use the folder baseline or new product layer without corrupting source state.\n'
    + 'Keep this practical and brief; it is a baseline check, not a reason to avoid useful software.\n'
    + '[/FOLDER-PRODUCT BASELINE CHECK]';
}

function appendFolderProductBaselinePrompt(message) {
  const block = folderProductBaselinePromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyFolderProductBaseline,
  folderProductBaselinePromptBlock,
  appendFolderProductBaselinePrompt
};
