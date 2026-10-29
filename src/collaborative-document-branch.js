'use strict';

// Deterministic collaborative-document branch nudge for dispatches that put
// more than one agent, person, or role onto a shared document/spec/file at the
// same time, or that branch/merge/version a durable artifact. Inspired by Jake
// Van Clief's Eduba collaborative-workspace lesson (videos hZ7hgHh_eYw,
// M7IFIVonXH0; concept branching-collaborative-document-workbenches): a
// multi-party AI workspace must be artifact-centered — a scalpel, not a
// chainsaw — with bounded role/output contracts, section/chunk targeting, a
// version/diff ledger, and an explicit merge/review path before source
// artifacts change. Operating rule: put the artifact at the center, give every
// agent a bounded edit contract, and never let branch outputs replace source
// without human/policy review.
//
// Distinct from review-debt (slice a large generation for review), fan-out
// partitionability (should independent work be parallelized at all), and
// workbench-outcome-review (post-build adoption review). This fires when the
// work itself is a shared artifact being changed by more than one party.

// Signals that more than one party edits the same thing.
const MULTI_PARTY_TERMS = [
  'collaborate', 'collaborating', 'collaboration', 'collaborative',
  'co-author', 'coauthor', 'co-authoring', 'co-write', 'cowrite', 'co-writing',
  'multi-agent', 'multi agent', 'multiple agents', 'several agents',
  'agents edit', 'agents editing', 'agents work on', 'agents rewrite',
  'multiple people', 'multiple teammates', 'several people', 'the team edits',
  'team edit', 'shared document', 'shared doc', 'shared file', 'shared spec',
  'shared artifact', 'concurrent edit', 'concurrent edits', 'concurrently edit',
  'parallel edit', 'parallel edits', 'simultaneous edit', 'at the same time',
  'hand off the doc', 'handoff the doc', 'round-robin edit'
];

// Signals that the work is a durable artifact (something that becomes state).
const ARTIFACT_TERMS = [
  'document', 'documents', 'doc', 'docs', 'spec', 'specs', 'specification',
  'manuscript', 'draft', 'drafts', 'wiki', 'report', 'reports', 'playbook',
  'playbooks', 'sop', 'sops', 'proposal', 'proposals', 'record', 'records',
  'file', 'files', 'artifact', 'artifacts', 'codebase', 'repository', 'repo',
  'plan', 'plans', 'schema', 'charter', 'brief', 'page', 'pages'
];

// Signals that a versioned/branch/merge discipline is in play.
const BRANCH_MERGE_TERMS = [
  'branch', 'branching', 'branches', 'fork', 'forking', 'forks', 'merge',
  'merging', 'merged', 'version', 'versioned', 'versioning', 'revision',
  'revisions', 'revise', 'revising', 'diff', 'diffs', 'variant', 'variants',
  'staging', 'staged', 'rollback the doc', 'change history', 'changelog',
  'track changes', 'who changed', 'edit history'
];

// If enough of these distinctive phrases are present the artifact-centered/
// branch discipline is already framed, so we should not nag. Kept deliberately
// specific: generic phrases like "output contract" or "review path" also appear
// in other dispatch-nudge blocks already appended earlier in the same prompt,
// so matching them here would silently suppress this check.
const FRAMED_TERMS = [
  'artifact-centered', 'artifact centered', 'artifact center',
  'bounded edit contract', 'edit contract', 'edit scope',
  'section targeting', 'chunk targeting', 'version ledger', 'diff ledger',
  'change ledger', 'merge review', 'merge decision', 'source discussion',
  'parent branch', 'branch review'
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word-boundary matching so short tokens cannot false-match inside other words.
function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    const pattern = new RegExp('\\b' + escapeRegExp(term) + '\\b');
    return pattern.test(text) ? count + 1 : count;
  }, 0);
}

function classifyCollaborativeDocumentBranch(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const multiParty = countMatches(text, MULTI_PARTY_TERMS);
  const artifact = countMatches(text, ARTIFACT_TERMS);
  const branchMerge = countMatches(text, BRANCH_MERGE_TERMS);
  const framed = countMatches(text, FRAMED_TERMS);
  const score = (multiParty * 3) + (branchMerge * 2) + artifact;

  if (multiParty === 0 && branchMerge === 0) {
    return { applies: false, reason: 'no multi-party or branch/merge signal', score };
  }
  if (artifact === 0) {
    return { applies: false, reason: 'multi-party signal without a durable artifact object', score };
  }
  if (framed >= 2) {
    return { applies: false, reason: 'artifact-centered branch discipline already framed', score };
  }
  if (score < 4) {
    return { applies: false, reason: 'weak collaborative-document signal', score };
  }

  const layer = multiParty >= 1 && branchMerge >= 1
    ? 'concurrent-edit-with-history'
    : (multiParty >= 1 ? 'multi-party-artifact-edit' : 'artifact-branch-merge');

  return {
    applies: true,
    reason: 'more than one party is changing a shared artifact; establish the artifact-centered branch/review discipline',
    score,
    layer,
    signals: { multiParty, artifact, branchMerge, framed }
  };
}

function collaborativeDocumentBranchPromptBlock(message) {
  const classification = classifyCollaborativeDocumentBranch(message);
  if (!classification.applies) return '';

  return '[COLLABORATIVE DOCUMENT BRANCH CHECK]\n'
    + 'This dispatch puts more than one agent, person, or role onto a shared artifact, or branches/versions a durable document. A multi-party AI workspace is not a chat room with bots — it is an artifact-centered workbench (a scalpel, not a chainsaw). Establish the discipline before editing. Keep this brief and then continue the task.\n'
    + '- Artifact center: name the source discussion (the goal, constraints, and decisions) separately from the active artifact (the document/spec/file that becomes state). Chat is context; the artifact is state.\n'
    + '- Role + output contract: give every agent/person a bounded edit contract — allowed inputs, allowed outputs, and the exact edit scope. \"Improve this\" is too broad for shared production work; a role is a contract, not a vibe.\n'
    + '- Section targeting: operate on named sections or chunks, not whole-artifact rewrites by default, so one editor does not destroy another\'s local intent or create review debt.\n'
    + '- Version/diff ledger: record what changed, who or what changed it, and why, so a human can see exactly what changed between versions.\n'
    + '- Branch/parent link: forked or focused work keeps a link back to the source section it targets, so branches cannot sprawl unattached.\n'
    + '- Merge/review path: branch outputs return through human or policy review before replacing the source artifact, with an explicit accept / reject / merge decision.\n'
    + '- Verdict: state whether this is a real artifact-centered branch/review workbench, or a chat room with bots / a whole-artifact rewrite. Prefer one strong agent plus role-scoped tools until separate runtimes, permissions, or ownership are genuinely required.\n'
    + '[/COLLABORATIVE DOCUMENT BRANCH CHECK]';
}

function appendCollaborativeDocumentBranchPrompt(message) {
  const block = collaborativeDocumentBranchPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyCollaborativeDocumentBranch,
  collaborativeDocumentBranchPromptBlock,
  appendCollaborativeDocumentBranchPrompt
};
