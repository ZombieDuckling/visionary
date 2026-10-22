# Augmentation-means nudge

## Goal
Apply Jake Van Clief's Engelbart lesson (video `2aUUAi4DI0k`, concept `augmentation-means-stack` in the knowledge repo): the four augmentation means — artifacts, language, methodology, training (H-LAM/T) — must all be present, and intelligence is the organization of complexity toward a goal, not the complexity itself. Map it to Visionary's dispatch surface with the smallest deterministic improvement.

## Scope
- Add `src/augmentation-means.js`: a deterministic nudge that fires when a dispatch adds a tool, feature, agent, or capability ("build a tool", "add a feature", "more agents", "build a connector", "we should augment…") unless the operator already named two or more of the means.
- Require the agent to label artifacts, language, methodology, and training present/weak/missing; name the higher-order role the human owns after each automation step; expose primitives instead of a feature inventory; state who is augmented and the hand-back point; and give a genuine-augmentation / bare-automation / tool-chasing verdict.
- Wire into the dispatch prompt-augmenter chain, add focused tests, README + workbench-catalog docs, and a `npm run check` syntax gate.
- Avoid database, UI, runtime, or schema rewrites.

## Why it matters
Visionary is a workflow/agent-orchestration dashboard whose failure mode is growing a feature/agent inventory instead of organizing complexity toward a goal. This lesson names that failure directly: tools are only the artifacts means, and shipping them without language, methodology, or training is bare automation or tool-chasing. The nudge keeps Visionary's capability-building posture honest and is intentionally distinct from the augment-over-automate nudge (riderless-automation claims) and the program-decomposition nudge (AI-as-worker decomposition) — this is the anatomy layer of augmentation.

## Verification
- `node --check src/augmentation-means.js`.
- Focused unit tests for classifier + prompt-block behavior.
- `npm run check`, plus the focused test file.
