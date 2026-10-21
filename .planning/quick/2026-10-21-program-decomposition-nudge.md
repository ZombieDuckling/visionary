# Program-decomposition nudge

## Goal
Apply Jake Van Clief's program-decomposition lesson (video `H2bYz5kIYk4`, concept `ai-is-part-of-a-program` in the knowledge repo): a program is instructions + a runner + surviving output/state, and AI occupies only the runner slot — treating the model as the whole program is the failure mode. Map it to Visionary's dispatch surface with the smallest deterministic improvement.

## Scope
- Add `src/program-decomposition.js`: a deterministic nudge that fires on AI-as-worker framing ("AI can do the work", "let AI handle it", "have AI do X", "now that AI can…") unless the operator already named the instructions/runner/hand-back frame.
- Require the instructions and where the why lives, the model/runtime named separately as the runner, the durable state that survives the run plus who can inspect it, the human hand-back point (the efficiency moat, never "none"), the ownership split between non-opinionated parts and the operator's own opinionated why, and verification that all four parts were named. When a prompt/context file is being authored, decompose the instruction sentence into goal/constraint/assumption/entity and reconcile returned assumptions into the file.
- Wire into the dispatch prompt-augmenter chain, add focused tests, README + workbench-catalog docs, and a `npm run check` syntax gate.
- Avoid database, UI, runtime, or schema rewrites.

## Why it matters
Visionary's product direction is agent roles/personalities for a position dispatched into real workflows. The failure mode this lesson names is accepting "the AI does it" as the whole plan — no named instructions/why, no durable state, no verification, and no human hand-back — which is exactly how a workflow dashboard degrades into a chat wrapper. The nudge keeps Visionary's dispatch posture decomposed, and is intentionally distinct from the system-decomposition nudge (production layers for AI-system/protocol builds) and the augment-over-automate nudge (challenging robot-mode automation claims).

## Verification
- `node --check src/program-decomposition.js`.
- Focused unit tests for classifier + prompt-block behavior.
- `npm run check`, plus the focused test file.
