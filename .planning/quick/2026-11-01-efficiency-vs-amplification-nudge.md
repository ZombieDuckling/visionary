# Efficiency-vs-amplification nudge

## Goal
Apply Jake Van Clief's bicycle-for-the-mind lesson (video `AiMOZIEcza0`, concept `augment-over-automate` in the knowledge repo): Jobs deliberately chose the word *bicycle* — a tool that "made a person do more, didn't replace the person" — against the era's default of buying computers to replace people "so we can be more efficient". Map the efficiency-as-replacement vs. person-amplification distinction to Visionary's dispatch surface with the smallest deterministic improvement.

## Scope
- Add `src/efficiency-vs-amplification.js`: a deterministic nudge that fires when a dispatch frames the win as efficiency or the removal of the human ("we can be more efficient", "reduce headcount", "fewer people", "do more with less", "replace the manual step", "cost savings", "more output") unless the operator already framed the amplification.
- Require the agent to name the value axis (efficiency-as-replacement vs. person-amplification), the amplified human capacity, the rider's retained decision, the structure supplied, the amplified-outcome measurement, the no-riderless-machine rule, and a verdict.
- Wire into the dispatch prompt-augmenter chain, add focused tests, README + workbench-catalog docs, and a `npm run check` syntax gate.
- Also fix the double-escaped line breaks in `src/augmentation-means.js` and `src/vibe-coded-audit.js`, whose prompt bodies were emitted as literal `\n` text instead of real newlines.
- Avoid database, UI, runtime, or schema rewrites.

## Why it matters
Visionary is a workflow/agent-orchestration dashboard whose value framing is the product: `augment-over-automate` covers the automation *posture* and `augmentation-means` covers the *anatomy* (artifacts/language/methodology/training), but nothing forced the *value claim* itself to distinguish "the human step goes away" from "the person does more and still steers". This lesson names that axis directly, and it is where offers, pitches, and success metrics quietly drift into replacement framing. The nudge keeps Visionary's framing honest without adding dependencies.

## Verification
- `node --check src/efficiency-vs-amplification.js`.
- Focused unit tests for classifier + prompt-block behavior (10 tests), plus the existing augmentation-means / vibe-coded-audit suites.
- `npm run check`, `npm run smoke`, `npm run test:unit`, and `npm run test:stream`.
