# Agent split justification nudge

## GSD quick context

- Trigger: background Visionary improvement pass after Jake Van Clief ingestion.
- Jake lesson: do not use agent count or generic harness work as the product value; compete at workflow/context/governance layer.
- Small change: add a deterministic dispatch nudge for requests that create/map agents, roles, personas, teams, or org structures.
- Acceptance: fresh dispatch prompt should ask the worker to justify why a distinct agent/persona is needed versus a context/workbench/router layer, and tests should cover detection and non-detection.

## Scope

- Add `src/agent-split.js`.
- Wire into `buildAgentPrompt`.
- Add unit tests and README mention.
- No DB/schema/UI changes.
