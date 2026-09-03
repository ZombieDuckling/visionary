# Workflow map dispatch nudge

## GSD quick context

- Source lesson: Jake Van Clief `aCtEdO4BGlY` — a real second brain maps nouns and verbs: teams, workflows, inputs, outputs, data, and relationships.
- Visionary fit: dispatch prompts that ask agents to design/work on teams, workflows, roles, docs, or knowledge systems should recover a compact node/edge map before building or automating.
- Scope: add a deterministic, tested prompt nudge. No database migration or UI rewrite.

## Acceptance criteria

- Ordinary small tasks are not polluted with the nudge.
- Team/workflow/role/context-memory tasks get a concise `[WORKFLOW-MAP CHECK]` block.
- The block asks for actors/nodes, actions/edges, inputs/outputs, source-of-truth files, and verification.
- Server dispatch composes the new nudge with the existing prompt guardrail chain.
- README documents the behavior.
- `npm run check`, targeted unit test, full unit tests, and `git diff --check` pass.
