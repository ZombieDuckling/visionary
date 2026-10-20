# Cross-domain adjacency nudge

## Goal
Apply Jake Van Clief's cross-domain eureka lesson (video `NvJGe4cV1kE`, concept `cross-domain-eureka-ledger` in the knowledge repo): existing interests act as a discount on the next adjacent skill, so the next learning/build target should be chosen at the overlap where the operator already has a head start, and each observed boost should be captured in a durable ledger. Map it to Visionary's dispatch/role surface with the smallest deterministic improvement.

## Scope
- Add `src/cross-domain-adjacency.js`: a deterministic nudge that fires on learning/build-selection requests (\"what should I learn/build next\", \"pick the next skill\", \"rank the roadmap\") unless the operator already named the overlap/adjacency frame.
- Require the domains already carried, the two domains the target sits between plus the concrete transfer, ranking by transfer discount rather than generic value, deliberate overlap choice with orthogonal skills kept as explicit exceptions, a dated eureka ledger, and verification that the target names the overlap and transfer.
- Wire into the dispatch prompt-augmenter chain, add focused tests, README + workbench-catalog docs, and a `npm run check` syntax gate.
- Avoid database, UI, runtime, or schema rewrites.

## Why it matters
Visionary's product direction is agent roles/personalities for a position, dispatched into real workflows. The failure mode this lesson names is choosing learning/build targets from generic \"high value\" or \"AI is valuable\" lists while ignoring the operator's existing head start — treating every skill as a zero-base start and missing the discount entirely. The nudge keeps Visionary's workload-recommendation posture adjacency-aware and distinct from the opportunity-routing nudge (market value) and the ai-workflow-ladder nudge (promoting a repeated workflow into files/scripts).

## Verification
- `node --check src/cross-domain-adjacency.js`.
- Focused unit tests for classifier + prompt-block behavior.
- `npm run check`, plus the focused test file.
