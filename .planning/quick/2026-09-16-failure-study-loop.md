# Quick: Failure-study dispatch nudge

## Trigger
Jake ingestion processed `zD22PKXtPQU` — failure is the fastest way to learn what to study.

## Decision
Add a small deterministic dispatch nudge for debug/failure/incident prompts so agents turn failures into scoped evidence, a fix, and one reusable learning asset instead of only patching symptoms.

## Scope
- Add `src/failure-study-loop.js` classifier and prompt block.
- Wire it into `buildAgentPrompt`.
- Add unit tests and README note.
- Keep it deterministic and no new dependencies.

## Verification
Run syntax checks and unit tests for the new module plus full verify if feasible.
