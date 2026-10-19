# Augment-over-automate nudge

## Goal
Apply Jake Van Clief's Engelbart lesson (video `oDpNYDAaIiM`, concept `augment-over-automate` in the knowledge repo): "the worst software only automates; the best software automates to augment." Map it to Visionary's dispatch/role surface with the smallest deterministic improvement.

## Scope
- Add `src/augment-over-automate.js`: a deterministic nudge that fires on riderless-automation claims ("autonomous", "hands-off", "unattended", "set-and-forget", "no human", "fully automated") unless the operator already named a human/steering frame.
- Require the augmented human role and multiplied capacity, the structure supplied (context, memory, files, examples, review gates), the practical steering points (intake, exceptions, approval, final judgment), the verification/rollback path, and the one step — if any — that is safe to fully automate.
- Wire into the dispatch prompt-augmenter chain, add focused tests and docs.
- Avoid database, UI, runtime, or schema rewrites.

## Why it matters
Visionary's product direction is agent roles/personalities for a position, dispatched into real workflows. The failure mode the lesson names is a "fully autonomous" pitch that never names the augmented human, the structure, or the checks — automation demoed because it is easy, while the harder structuring of collaboration is skipped. The nudge keeps Visionary's dispatch posture augmentation-first and distinct from the workflow-capture nudge (written procedure) and the automation-timing rubric (whether to escalate a step).

## Verification
- `node --check src/augment-over-automate.js`.
- Focused unit tests for classifier + prompt-block behavior (6 passing).
- `npm run check`, plus the focused test file.
