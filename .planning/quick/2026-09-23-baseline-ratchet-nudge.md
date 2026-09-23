# Quick: baseline ratchet dispatch nudge

## Context
- Latest Jake ingestion included `Py4UW658l_c`: powerful AI capabilities become boring infrastructure quickly.
- Visionary already has challenge-design nudges, but no dedicated dispatch check for prompts that ask agents to improve/modernize/rebaseline an existing workflow after tool capability changes.

## Small change
Add a deterministic baseline-ratchet nudge that asks agents to compare old manual/current AI baselines against a new higher-value expectation and verification criteria before executing workflow/product improvement requests.

## Acceptance
- New nudge module with unit tests.
- Wired into `buildAgentPrompt`.
- README documents the feature.
- `npm run check` and targeted unit test pass.
