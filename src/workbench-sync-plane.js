'use strict';

// Deterministic workbench-sync nudge for MCP/connector/shared-folder tasks.
// Inspired by Jake Van Clief's MCP workbench lesson: connectors should be the
// sync/auth plane around portable folder workbenches, not a substitute for
// source templates, mutable copies, export manifests, review surfaces, and
// secret isolation.

const WORKBENCH_TERMS = [
  'workbench', 'workbenches', 'workspace', 'workspaces', 'folder', 'folders',
  'repo', 'repository', 'knowledgebase', 'knowledge base', 'second brain',
  'template', 'packet', 'source package', 'file tree', 'files'
];

const CONNECTOR_TERMS = [
  'mcp', 'connector', 'connectors', 'sync', 'client', 'clients', 'claude',
  'openai', 'chatgpt', 'hermes', 'cursor', 'codex', 'api', 'integration',
  'integrations', 'import', 'export', 'zip', 'handoff'
];

const BOUNDARY_TERMS = [
  'org', 'organization', 'permission', 'permissions', 'auth', 'scope', 'scopes',
  'access', 'secret', 'secrets', 'credential', 'credentials', 'token', 'tokens',
  'private', 'shared', 'collaborator', 'collaborators', 'review', 'diff',
  'manifest', 'audit', 'history', 'identity'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyWorkbenchSyncPlane(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const workbenchMatches = countMatches(text, WORKBENCH_TERMS);
  const connectorMatches = countMatches(text, CONNECTOR_TERMS);
  const boundaryMatches = countMatches(text, BOUNDARY_TERMS);
  const score = (workbenchMatches * 2) + (connectorMatches * 3) + (boundaryMatches * 2);

  if (workbenchMatches === 0 || connectorMatches === 0) {
    return { applies: false, reason: 'no workbench-to-connector shape', score };
  }
  if (score < 8) {
    return { applies: false, reason: 'weak workbench-sync signal', score };
  }

  const layer = boundaryMatches >= 3 || text.indexOf('secret') !== -1 || text.indexOf('permission') !== -1
    ? 'scoped-sync-auth-plane'
    : text.indexOf('export') !== -1 || text.indexOf('manifest') !== -1 || text.indexOf('handoff') !== -1
      ? 'import-export-continuity-plane'
      : 'portable-workbench-sync-plane';

  return {
    applies: true,
    reason: 'portable workbench state is being connected across clients or integrations',
    score,
    layer,
    signals: {
      workbench: workbenchMatches,
      connector: connectorMatches,
      boundary: boundaryMatches
    }
  };
}

function workbenchSyncPlanePromptBlock(message) {
  const classification = classifyWorkbenchSyncPlane(message);
  if (!classification.applies) return '';

  return '[WORKBENCH-SYNC PLANE CHECK]\n'
    + 'This looks like a workbench/folder/repo being connected to AI clients, MCP, APIs, imports, exports, or collaborators. Treat connectors as the sync/auth plane around portable files, not as the source of truth.\n'
    + '- Portable object: name the folder/repo/workbench/template packet that carries the durable source state.\n'
    + '- Copy boundary: distinguish source template, active mutable workspace, drafts/exports, and what must not be edited in place.\n'
    + '- Scope boundary: name the org/workspace/project/user boundary each connector or client is allowed to see or change.\n'
    + '- Secret boundary: keep provider keys, tokens, credentials, local caches, and raw private data outside editable/exportable workbench artifacts.\n'
    + '- Import/export manifest: record included files, excluded files, metadata, current state, and enough continuation context for another approved client/operator.\n'
    + '- Review surface: expose changed files, actor/client identity when known, diff/history, and a human acceptance path before shared state is trusted.\n'
    + 'Keep this practical; do not add MCP/platform complexity if a well-routed folder and manifest solves the job.\n'
    + '[/WORKBENCH-SYNC PLANE CHECK]';
}

function appendWorkbenchSyncPlanePrompt(message) {
  const block = workbenchSyncPlanePromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyWorkbenchSyncPlane,
  workbenchSyncPlanePromptBlock,
  appendWorkbenchSyncPlanePrompt
};