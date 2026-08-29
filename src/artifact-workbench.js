'use strict';

// Deterministic artifact-workbench nudge for dispatches where an agent may edit
// or produce shared documents/specs/artifacts. Inspired by Jake Van Clief's
// Aduba/Eduba lesson: collaboration works better when the artifact, target
// section, role contract, diff/version ledger, branch, and merge/review path are
// explicit instead of hidden inside chat.

const ARTIFACT_TERMS = [
  'artifact', 'artifacts', 'document', 'documents', 'doc', 'docs', 'spec', 'specs',
  'proposal', 'brief', 'runbook', 'playbook', 'readme', 'markdown', 'md', 'file',
  'files', 'report', 'ledger', 'canvas', 'workbench', 'template', 'draft'
];

const EDIT_TERMS = [
  'edit', 'edits', 'update', 'rewrite', 'revise', 'merge', 'change', 'changes',
  'patch', 'diff', 'version', 'branch', 'section', 'chunk', 'review', 'approve',
  'accept', 'reject', 'replace', 'publish', 'produce', 'create', 'write'
];

const COLLAB_TERMS = [
  'agent', 'agents', 'role', 'roles', 'persona', 'personality', 'team',
  'collaborate', 'collaboration', 'handoff', 'source discussion', 'thread',
  'comments', 'feedback', 'stakeholder', 'operator', 'human'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyArtifactWorkbench(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const artifactMatches = countMatches(text, ARTIFACT_TERMS);
  const editMatches = countMatches(text, EDIT_TERMS);
  const collabMatches = countMatches(text, COLLAB_TERMS);
  const score = (artifactMatches * 2) + (editMatches * 2) + collabMatches;

  if (artifactMatches === 0 || editMatches === 0) {
    return { applies: false, reason: 'not artifact-edit shaped', score };
  }
  if (score < 6) {
    return { applies: false, reason: 'weak artifact-workbench signal', score };
  }

  const layer = collabMatches >= 2 || text.indexOf('branch') !== -1 || text.indexOf('merge') !== -1
    ? 'collaborative-artifact-workbench'
    : editMatches >= 3
      ? 'section-scoped-artifact-edit'
      : 'lightweight-artifact-writeback';

  return {
    applies: true,
    reason: 'artifact/document work may need scoped edits and reviewable write-back',
    score,
    layer,
    signals: {
      artifact: artifactMatches,
      edit: editMatches,
      collaboration: collabMatches
    }
  };
}

function artifactWorkbenchPromptBlock(message) {
  const classification = classifyArtifactWorkbench(message);
  if (!classification.applies) return '';

  return '[ARTIFACT-WORKBENCH CHECK]\n'
    + 'If this task changes or produces a durable artifact, center the work on the artifact rather than the chat. Keep this proportional to the task.\n'
    + '- Source discussion: name the operator request, thread, issue, or brief that supplies intent and constraints.\n'
    + '- Active artifact: name the file/spec/document/report being changed or created, plus the current branch/workdir if relevant.\n'
    + '- Bounded role contract: state your role, allowed edit scope, expected output, and what you will not rewrite.\n'
    + '- Section targeting: prefer named sections/chunks over whole-document rewrites unless a full rewrite is explicitly required.\n'
    + '- Change ledger: report what changed, why, and where a human can inspect the diff/version/artifact.\n'
    + '- Merge/review path: leave acceptance criteria and any open decisions for operator/reviewer approval before source artifacts are treated as final.\n'
    + 'Do not add process theater; apply these bullets briefly while still delivering the requested work.\n'
    + '[/ARTIFACT-WORKBENCH CHECK]';
}

function appendArtifactWorkbenchPrompt(message) {
  const block = artifactWorkbenchPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyArtifactWorkbench,
  artifactWorkbenchPromptBlock,
  appendArtifactWorkbenchPrompt
};
