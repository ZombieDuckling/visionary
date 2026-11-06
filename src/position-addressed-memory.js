'use strict';

// Deterministic position-addressed-memory nudge for requests that design how an
// AI remembers or retrieves context for a workflow — "build the knowledge base",
// "should we add a vector database", "let the agent remember across sessions",
// "how should we organize memory", "set up a second brain", "make the agent
// retrieve our docs". Inspired by Jake Van Clief's position-addressed-memory
// lesson (concept position-addressed-memory; video hALln9wrrQo): there are three
// practical ways a system can "remember" — position-addressed (folders, paths,
// filenames, cascading instructions, templates, local routing files carry the
// meaning), link-addressed (wiki/entity graph/maintained notes followed by
// explicit links), and content-addressed (embeddings/vector/semantic search).
// For most shipping workflows position-addressed memory is the cheapest first
// layer: a path like projects/client/scene-03.md tells the model and the human
// the client, deliverable, stage, and expected conventions before the file body
// is read. The failure mode this prevents is building embeddings or a vector DB
// before the workflow has a stable folder/process shape, hiding core workflow
// state inside one vendor's chat/memory store, and putting all context in one
// giant file or transcript.
//
// Visionary already carries this as a concept note in the knowledge repo
// (concepts/position-addressed-memory.md) and its own artifact layout —
// ~/Visionary/<project>/task-<id> — is the local instance of the pattern, but
// nothing applied the address-mode choice at dispatch time. This nudge makes the
// operator's agents name the address mode and lay out the workspace before
// reaching for embeddings.
//
// This is the *memory address mode and workspace layout* layer. Distinct from
// scoped-memory-routing (where a single preference or procedure is stored),
// context-boundary (what context crosses a boundary), company-brain (org-scoped
// navigable knowledge), continuity-workbench (resuming one workflow), and
// prompt-and-memory-hierarchy (what is always vs. conditionally loaded).

const MEMORY_TERMS = [
  'memory', 'memories', 'remember', 'remembers', 'remembering', 'recall',
  'retrieval', 'retrieve', 'rag', 'vector', 'vector db', 'vector database',
  'embedding', 'embeddings', 'semantic search', 'similarity search',
  'knowledge base', 'knowledgebase', 'knowledge-base', 'corpus', 'second brain',
  'knowledge graph', 'wiki', 'brain', 'long-term memory', 'long term memory',
  'memory system', 'memory architecture'
];

// The address-mode choice and workspace-layout decision: a decision/build verb
// plus how/where context is stored and found.
const ARCHITECTURE_TERMS = [
  'design', 'architect', 'architecture', 'structure', 'layout', 'organize',
  'organise', 'set up', 'setup', 'build', 'choose', 'pick', 'which', 'decide',
  'how should', 'where should', 'should we', 'should i', 'going to', 'add',
  'need', 'need to', 'want', 'want to', 'let', 'help', 'store', 'save',
  'persist', 'index', 'catalog', 'folder', 'folders', 'directory',
  'directories', 'path', 'paths', 'file structure', 'folder structure',
  'workspace', 'workspace layout', 'navigate', 'navigation', 'map', 'hierarchy',
  'reuse', 'fresh session', 'new session'
];

// Signals the operator already named the address mode and its layout, so the
// nudge steps back rather than nagging.
const ADDRESS_FRAME_TERMS = [
  'position-addressed', 'position addressed', 'link-addressed', 'link addressed',
  'content-addressed', 'content addressed', 'address mode', 'front desk',
  'cascading context', 'cascading instruction', 'raw and derived',
  'raw vs derived', 'raw/derived', 'source vs derived', 'routing file',
  'folder as instruction', 'folder-as-instruction', 'portable state',
  'no vector', 'skip the vector', 'without embeddings', 'folder structure suffices',
  'readme front desk', 'manifest and review surface'
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-word matching (not naive substring) so short terms such as "rag",
// "path", and "map" cannot false-match inside longer words.
function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    const pattern = new RegExp('\\b' + escapeRegExp(term) + '\\b');
    return pattern.test(text) ? count + 1 : count;
  }, 0);
}

function classifyPositionAddressedMemory(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const memory = countMatches(text, MEMORY_TERMS);
  const architecture = countMatches(text, ARCHITECTURE_TERMS);
  const addressFrame = countMatches(text, ADDRESS_FRAME_TERMS);
  const score = (memory * 3) + (architecture * 2) - (addressFrame * 3);

  // Need a memory/retrieval concept plus an architecture/storage decision:
  // designing how the agent remembers, not just describing that it does.
  if (memory === 0) {
    return { applies: false, reason: 'no memory/retrieval signal', score };
  }
  if (architecture === 0) {
    return { applies: false, reason: 'memory named without a storage/layout decision', score };
  }
  if (addressFrame >= 2) {
    return { applies: false, reason: 'operator already named the address mode and its layout', score };
  }
  if (score < 7) {
    return { applies: false, reason: 'weak position-addressed-memory signal', score };
  }

  const layer = memory >= 3 || architecture >= 3
    ? 'memory-architecture-review'
    : 'address-mode-check';

  return {
    applies: true,
    reason: 'choose the memory address mode (position/link/content/hybrid) and lay out the workspace before reaching for embeddings',
    score,
    layer,
    signals: { memory: memory, architecture: architecture, address_frame: addressFrame }
  };
}

function positionAddressedMemoryPromptBlock(message) {
  const classification = classifyPositionAddressedMemory(message);
  if (!classification.applies) return '';

  return '[POSITION-ADDRESSED MEMORY CHECK]\n'
    + 'This request is designing how an AI remembers or retrieves context for a workflow. Choose the memory address mode and lay out the workspace before reaching for embeddings or a vector database.\n'
    + '- Address mode: name the mode the job needs \u2014 position-addressed (folders/paths/filenames/cascading instructions/templates/local routing files carry the meaning), link-addressed (wiki/entity graph/maintained notes followed by explicit links), content-addressed (embeddings/vector/semantic search), or hybrid.\n'
    + '- Prefer position first: for shipping workflows, a folder/path/routing-file structure is the cheapest, human-inspectable, and provider-portable layer; a path like projects/client/scene-03.md tells the model and human the client, deliverable, stage, and conventions before the file body is read.\n'
    + '- Do not build embeddings before the workflow has a stable folder/process shape; add link- or content-addressed memory only when cross-project discovery, oversized/messy sources, or changing entity relationships actually require it.\n'
    + '- Lay out the workbench: front desk (README/CLAUDE.md orientation), canonical manifest (work items, statuses, source links, outputs), cascading context (root + project/client/stage files), templates/primitives, source-vs-derived separation (raw material kept apart from notes, decisions, outputs, scripts), a review surface (diffs/checklists/acceptance criteria), and a portability constraint (do not hide core workflow state inside one vendor\'s chat/memory store).\n'
    + '- Fresh-session continuity: keep human-legible paths and an index so a fresh session can orient without replaying prior chat; treat repo/folder layout as model-readable instruction, not mere storage.\n'
    + '- Failure mode: one giant context file or transcript, flat uneditable output piles, vendor memory used for core state, or embeddings built before the process has a stable shape.\n'
    + '- Verdict: the chosen address mode (position/link/content/hybrid), the folder/routing structure, and what (if anything) escalates to link or content addressing.\n'
    + '[/POSITION-ADDRESSED MEMORY CHECK]';
}

function appendPositionAddressedMemoryPrompt(message) {
  const block = positionAddressedMemoryPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyPositionAddressedMemory,
  positionAddressedMemoryPromptBlock,
  appendPositionAddressedMemoryPrompt
};
