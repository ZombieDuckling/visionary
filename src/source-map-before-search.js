'use strict';

// Deterministic source-map nudge for repo/folder/workbench tasks. Inspired by
// Jake Van Clief's "folders, texts, and components" lesson: a file tree is a
// routing layer, not decoration. Agents should orient on stable paths before
// broad search/edit passes when work spans a project or workspace.

const WORKSPACE_TERMS = [
  'repo', 'repository', 'codebase', 'project', 'workspace', 'workbench',
  'folder', 'folders', 'directory', 'directories', 'file tree', 'tree',
  'monorepo', 'package', 'module', 'component', 'components', 'docs',
  'documentation', 'source files', 'scripts', 'logs', 'artifacts'
];

const ACTION_TERMS = [
  'find', 'locate', 'inspect', 'review', 'audit', 'map', 'understand',
  'analyze', 'analyse', 'change', 'edit', 'modify', 'fix', 'refactor',
  'wire', 'integrate', 'implement', 'continue', 'resume', 'onboard',
  'handoff', 'debug', 'trace', 'verify', 'document', 'catalog', 'catalogue'
];

const TREE_FRAME_TERMS = [
  'file tree', 'folder tree', 'directory tree', 'source map', 'repo map',
  'workspace map', 'routing map', 'path map', 'front desk', 'where files live',
  'readme first', 'readme', 'manifest', 'index of files', 'tree before search'
];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    const pattern = new RegExp('(^|[^a-z0-9])' + escapeRegExp(term) + '($|[^a-z0-9])', 'i');
    return pattern.test(text) ? count + 1 : count;
  }, 0);
}

function classifySourceMapBeforeSearch(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const workspace = countMatches(text, WORKSPACE_TERMS);
  const action = countMatches(text, ACTION_TERMS);
  const treeFrame = countMatches(text, TREE_FRAME_TERMS);
  const score = (workspace * 3) + (action * 2) - (treeFrame * 3);

  if (treeFrame >= 2) {
    return { applies: false, reason: 'operator already supplied source-map frame', score };
  }
  if (workspace === 0) {
    return { applies: false, reason: 'no repo/folder/workspace signal', score };
  }
  if (action === 0) {
    return { applies: false, reason: 'workspace mention without navigation/edit action', score };
  }
  if (score < 5) {
    return { applies: false, reason: 'source-map signal too weak', score };
  }

  const layer = workspace >= 5 || text.indexOf('onboard') !== -1 || text.indexOf('handoff') !== -1
    ? 'workspace-orientation'
    : action >= 2 && workspace >= 2
      ? 'path-bounded-execution'
      : 'lightweight-source-map';

  return {
    applies: true,
    reason: 'repo/folder work should orient on the file tree before broad search or edits',
    score,
    layer,
    signals: {
      workspace,
      action,
      tree_frame: treeFrame
    }
  };
}

function sourceMapBeforeSearchPromptBlock(message) {
  const classification = classifySourceMapBeforeSearch(message);
  if (!classification.applies) return '';

  return '[SOURCE-MAP BEFORE SEARCH CHECK]\n'
    + 'This looks like repo/folder/workbench work. Before broad search or edits, orient on the smallest useful file tree/source map so paths become routing context.\n'
    + '- Existing map first: read the README, HANDOFF, manifest, index, or routing file if present before inventing a new map.\n'
    + '- Concise tree: name the relevant directories/files and why they matter; avoid dumping unrelated vendor/cache/build folders.\n'
    + '- Path-bounded search: search from the likely directory or file class first, then broaden only if the map is wrong or incomplete.\n'
    + '- Stable references: preserve exact paths in notes, edits, artifacts, and handoffs so the next agent can continue without rediscovery.\n'
    + '- Verification: when files are changed or cited, check that referenced paths still exist and that generated indexes/links point to real files.\n'
    + 'Keep this proportional; the source map is a navigation aid, not a substitute for doing the work.\n'
    + '[/SOURCE-MAP BEFORE SEARCH CHECK]';
}

function appendSourceMapBeforeSearchPrompt(message) {
  const block = sourceMapBeforeSearchPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifySourceMapBeforeSearch,
  sourceMapBeforeSearchPromptBlock,
  appendSourceMapBeforeSearchPrompt
};
