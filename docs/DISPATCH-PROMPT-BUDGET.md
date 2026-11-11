# Dispatch prompt budget

Visionary ships a library of deterministic dispatch nudges — continuity, source
provenance, secret isolation, review gates, cost framing, and so on — each one a
Jake Van Clief lesson turned into an instruction block prepended to an agent's
task.

Those blocks are useful. Unbounded, they are also a tax: the operator's request
stops being the largest thing in the prompt, token spend climbs, and unrelated
instructions compete for the model's attention.

## The bug this replaced

Until 2.1.15 the dispatch path chained the nudges like this:

```js
const agentMessage = augmenters.reduce((current, fn) => fn(current), message);
```

Every nudge appended its block to the same string the next classifier read, so
block vocabulary re-triggered unrelated nudges. `"Fix the login bug in
server.js"` (30 characters) grew to **49,457 characters across 41 blocks** —
about 12k tokens of instructions for a one-line bug report. The blocks were
self-inflating: `media-provenance` fired because another block mentioned
"media", `voice-file` fired because a block mentioned "content", and so on.

## The rule

`src/prompt-pipeline.js` enforces three invariants:

1. **Classification reads evidence, never instructions.** Every nudge is
   classified against the operator's original message only. Injected blocks are
   instructions and are never fed back into the classifiers. This is the
   prompt-and-memory-hierarchy boundary: instructions, evidence, output, and
   credentials stay separate.
2. **Ranking is deterministic and signal-based.** Candidates are ordered by the
   classifier's own score, with the module id as a stable tie-break. No model
   call, no randomness, no operator-specific weighting.
3. **Injection is capped.** A count cap and a character budget bound what can be
   added. Blocks that do not fit are dropped whole — never truncated mid-block —
   and every drop is recorded with its reason.

If nothing fits the budget, the single strongest signal is still injected: an
empty dispatch is worse than a slightly over-budget one. If no classifier fires,
the operator's message is passed through untouched.

## Defaults and overrides

| Env var | Default | Meaning |
|---|---|---|
| `VISIONARY_NUDGE_BUDGET_CHARS` | `6000` | Hard ceiling on injected nudge characters. `0` disables the cap. |
| `VISIONARY_NUDGE_MAX` | `4` | Maximum number of nudge blocks per dispatch. `0` disables the count cap. |

Budget changes are operator decisions, not model decisions: raise the cap when
dispatches feel under-specified, lower it when runs are burning input tokens on
generic guidance.

## Telemetry

Each dispatch stores a `prompt_meta_json` record on its `agent_runs` row
(migration 11):

```json
{
  "original_chars": 30,
  "nudge_chars": 884,
  "prompt_chars": 916,
  "budget_chars": 6000,
  "max_nudges": 4,
  "applied": [{ "id": "failure-study-loop", "score": 7, "chars": 884 }],
  "dropped": [],
  "errors": []
}
```

The task detail panel renders this as a `Prompt context` line under the run
header, with the applied module ids in the tooltip. That makes prompt cost a
per-run, inspectable number instead of an invisible multiplier on every
dispatch, and it makes a mis-firing classifier visible instead of silent.

## Failure behavior

A nudge module that throws during classification or block generation is skipped
and recorded in `errors`; dispatch continues. The pipeline is a filter, not a
dependency.

## Measured effect

| Request | Before | After |
|---|---|---|
| `Fix the login bug in server.js` | 49,457 chars, 41 blocks | 916 chars, 1 block |
| Client onboarding dashboard (118 chars) | 51,792 chars, 46 blocks | 3,854 chars, 4 blocks |
| Product roadmap / next-build decision (188 chars) | 51,862 chars, 46 blocks | 4,245 chars, 4 blocks |
| API-key rotation + redeploy (71 chars) | — | 4,702 chars, 4 blocks, secret-isolation ranked first |

The secret-rotation case is the check that matters: tightening the pipeline must
not lose the blocks that carry real risk. `tests/prompt-pipeline.test.mjs`
asserts that, plus ranking order, budget enforcement, error isolation, and
determinism.

## Adding a nudge

Add the module to `NUDGE_MODULES` in `src/prompt-pipeline.js` and export a
`classify*` function plus a `*PromptBlock` function from the module. The loader
fails loudly if the shape is wrong, and the registry test fails if the module
list and the loader disagree. Do not add an append call to `server.js`; the
pipeline owns assembly now.
