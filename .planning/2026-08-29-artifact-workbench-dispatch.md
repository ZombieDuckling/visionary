# GSD Quick: Artifact-centered dispatch prompts

## Goal
Add a small deterministic prompt guard so Visionary dispatches that edit documents/specs/artifacts ask agents to name the active artifact, target section, role/output contract, change ledger, and merge/review path.

## Jake lesson used
The Jake Van Clief Aduba/Eduba notes describe branching collaborative document workbenches: source discussion, active artifact, bounded role agents, section-level edits, visible diffs/version ledger, branch discussions, and merge/review decisions. Visionary should apply this only when a task is artifact/document/workbench shaped, not to every chat.

## Scope
- Add `src/artifact-workbench.js` classifier + prompt block.
- Inject it into `buildAgentPrompt()` alongside existing Jake-derived prompt nudges.
- Add focused node:test coverage.
- Update the workbench catalog heuristic.

## Verification
Run:
- `npm run check`
- `node --test tests/artifact-workbench.test.mjs`
- `npm run test:unit`
- `git diff --check`
