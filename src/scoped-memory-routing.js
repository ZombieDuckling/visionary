'use strict';

// Deterministic scoped-memory routing nudge for requests that ask agents to
// remember preferences, procedures, examples, or project rules. Inspired by
// Jake Van Clief's scoped memory lesson: many “forgot my preference” failures
// are not missing-memory failures; they are routing failures where durable
// context is stored at the wrong scope or always loaded into unrelated work.

const MEMORY_TERMS = [
  'remember', 'memory', 'memories', 'preference', 'preferences', 'instruction',
  'instructions', 'rule', 'rules', 'procedure', 'procedures', 'sop', 'playbook',
  'skill', 'skills', 'profile', 'context', 'knowledge', 'example', 'examples',
  'style', 'voice', 'taste', 'router', 'routing'
];

const CAPTURE_TERMS = [
  'save', 'store', 'record', 'capture', 'add', 'update', 'write', 'promote',
  'move', 'route', 'organize', 'index', 'load', 'retrieve', 'scope', 'scoped',
  'global', 'project', 'folder', 'workbench', 'raw', 'archive'
];

const CROSS_SCOPE_TERMS = [
  'global', 'persistent', 'project', 'repo', 'repository', 'workspace', 'folder',
  'workbench', 'skill', 'profile', 'chat', 'session', 'transcript', 'raw',
  'archive', 'always', 'every time', 'only when', 'unrelated', 'different workflow'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyScopedMemoryRouting(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const memory = countMatches(text, MEMORY_TERMS);
  const capture = countMatches(text, CAPTURE_TERMS);
  const scope = countMatches(text, CROSS_SCOPE_TERMS);
  const score = (memory * 3) + (capture * 2) + (scope * 2);

  if (memory === 0) {
    return { applies: false, reason: 'no memory/preference/procedure signal', score };
  }
  if (capture === 0 && scope < 2) {
    return { applies: false, reason: 'descriptive mention, not memory routing work', score };
  }
  if (score < 9) {
    return { applies: false, reason: 'weak scoped-memory signal', score };
  }

  const layer = scope >= 3
    ? 'cross-scope-memory-routing'
    : capture >= 1
      ? 'memory-capture-routing'
      : 'preference-scope-check';

  return {
    applies: true,
    reason: 'memory/preference/procedure should be routed to the smallest durable scope',
    score,
    layer,
    signals: { memory, capture, scope }
  };
}

function scopedMemoryRoutingPromptBlock(message) {
  const classification = classifyScopedMemoryRouting(message);
  if (!classification.applies) return '';

  return '[SCOPED-MEMORY ROUTING CHECK]\n'
    + 'This task may create or move durable memory, preferences, procedures, examples, or routing rules. Do not default to global memory or hidden chat state. Route each item to the smallest scope where a fresh session can find and apply it correctly.\n'
    + '- Classify the item: stable user fact, cross-project preference, project rule, repeatable procedure/skill, task/workbench example, generated output, or raw evidence.\n'
    + '- Choose the storage scope: global/profile only for cross-project facts; project docs/router for project defaults; skill/procedure file for repeatable methods; workbench folder for task-specific examples/acceptance criteria; raw archive for evidence.\n'
    + '- Prevent bleed: state what unrelated workflow should not receive this rule, and avoid always-loading niche context.\n'
    + '- Add a retrieval handle: file path, folder, index entry, tag, or router note that lets a fresh agent load only the relevant context.\n'
    + '- Add a lightweight check: example, acceptance criterion, test, or review question that proves the rule applies in-scope and not out-of-scope.\n'
    + 'If no durable storage is needed, say so and keep the result local to the task.\n'
    + '[/SCOPED-MEMORY ROUTING CHECK]';
}

function appendScopedMemoryRoutingPrompt(message) {
  const block = scopedMemoryRoutingPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyScopedMemoryRouting,
  scopedMemoryRoutingPromptBlock,
  appendScopedMemoryRoutingPrompt
};
