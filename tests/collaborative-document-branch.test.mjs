import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyCollaborativeDocumentBranch,
  collaborativeDocumentBranchPromptBlock,
  appendCollaborativeDocumentBranchPrompt
} = require('../src/collaborative-document-branch.js');

test('classifyCollaborativeDocumentBranch ignores empty and unrelated prompts', () => {
  assert.equal(classifyCollaborativeDocumentBranch('').applies, false);
  const result = classifyCollaborativeDocumentBranch('Summarize the meeting notes and send a digest');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'no multi-party or branch/merge signal');
  assert.equal(collaborativeDocumentBranchPromptBlock('Summarize the meeting notes and send a digest'), '');
});

test('classifyCollaborativeDocumentBranch needs a durable artifact, not just collaboration', () => {
  const result = classifyCollaborativeDocumentBranch('The two of us should collaborate more often');
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'multi-party signal without a durable artifact object');
});

test('classifyCollaborativeDocumentBranch does not match tokens as substrings', () => {
  // 'doc' must not match inside 'document'-less words, and 'spec' must not
  // match bare network/build chatter.
  const result = classifyCollaborativeDocumentBranch('The build is based on a stable network');
  assert.equal(result.applies, false);
});

test('classifyCollaborativeDocumentBranch flags multiple agents on a shared document', () => {
  const result = classifyCollaborativeDocumentBranch('Have the agents collaborate on the shared spec document');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'multi-party-artifact-edit');
  assert.ok(result.signals.multiParty >= 1);
  assert.ok(result.signals.artifact >= 1);
});

test('classifyCollaborativeDocumentBranch flags concurrent editing with history', () => {
  const result = classifyCollaborativeDocumentBranch('Multiple agents edit the proposal doc at the same time and track changes');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'concurrent-edit-with-history');
});

test('classifyCollaborativeDocumentBranch flags branching and merging a wiki page', () => {
  const result = classifyCollaborativeDocumentBranch('Branch the wiki page and merge the drafts');
  assert.equal(result.applies, true);
  assert.equal(result.layer, 'artifact-branch-merge');
  assert.ok(result.signals.branchMerge >= 2);
});

test('classifyCollaborativeDocumentBranch does not nag when the discipline is already framed', () => {
  const message = 'Collab on the shared doc with merge review and a diff ledger';
  const result = classifyCollaborativeDocumentBranch(message);
  assert.equal(result.applies, false);
  assert.equal(result.reason, 'artifact-centered branch discipline already framed');
});

test('collaborativeDocumentBranchPromptBlock names the artifact-centered parts', () => {
  const block = collaborativeDocumentBranchPromptBlock('Have several agents work on the codebase in parallel');
  assert.match(block, /COLLABORATIVE DOCUMENT BRANCH CHECK/);
  assert.match(block, /Artifact center:/);
  assert.match(block, /Role \+ output contract:/);
  assert.match(block, /Section targeting:/);
  assert.match(block, /Version\/diff ledger:/);
  assert.match(block, /Branch\/parent link:/);
  assert.match(block, /Merge\/review path:/);
  assert.match(block, /Verdict:/);
});

test('appendCollaborativeDocumentBranchPrompt preserves the original request first and is a no-op otherwise', () => {
  const message = 'Draft variants of the landing page and stage them';
  const augmented = appendCollaborativeDocumentBranchPrompt(message);
  assert.ok(augmented.startsWith(message));
  assert.match(augmented, /\[COLLABORATIVE DOCUMENT BRANCH CHECK\]/);

  const unrelated = 'Rename the column header';
  assert.equal(appendCollaborativeDocumentBranchPrompt(unrelated), unrelated);
});
