# Workflow-capture (two-minute test) nudge

## Goal
Apply Jake Van Clief's newest "capture the workflow before automating it" lesson (video `k27PW7ZwmS8`, two-minute test + input/do/output/human-check schema) to Visionary's dispatch prompts with the smallest deterministic improvement.

## Scope
- Add `src/workflow-capture.js`: a deterministic nudge for repeated jobs being automated, scheduled, or delegated to an agent.
- Require the operator/agent to capture the procedure (two-minute test, input/do/output/human-check), surface trip-ups via a fresh reader, and reproduce in a fresh chat before building scripts/agents/integrations.
- Wire into the dispatch prompt-augmenter chain, add focused tests and docs.
- Avoid database, UI, runtime, or schema rewrites.

## Why it matters
Visionary's core failure mode is dispatching agent work for a repeated job nobody has written down. Capturing the procedure first is the prerequisite asset and protects dispatch output quality; it also keeps automation tied to `docs/AUTOMATION-TIMING-RUBRIC.md` rather than jumping straight to agents.

## Verification
- `node --check src/workflow-capture.js`.
- Unit tests for classifier + prompt block behavior.
- `git diff --check`, plus the focused test file.
