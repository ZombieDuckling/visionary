# GSD Quick — Challenge Design Dispatch Nudge

## Context
Nightly Jake Van Clief ingestion highlighted the AI baseline ratchet: if AI makes the old task easy, the workflow should raise the bar toward critique, evidence, originality, taste, and acceptance criteria instead of accepting generic fast output.

## Target
Add a small deterministic prompt nudge for Visionary dispatches that look like generic create/draft/summarize/plan work, so agents briefly define a higher bar before producing output.

## Constraints
- Small additive change only.
- No new dependencies.
- Preserve existing dispatch prompt pipeline.
- Avoid process theater: only apply when signals indicate low-specificity output work.

## Verification
- Add focused node:test coverage.
- Run syntax check and relevant unit tests.
- Run full verify if time allows.
