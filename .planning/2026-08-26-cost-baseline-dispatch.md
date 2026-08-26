# GSD Quick: Cost baseline telemetry

## Context
- Background Visionary improvement pass.
- Jake Van Clief latest ingestion emphasized comparing AI spend against realistic human/search/workflow baselines, not imaginary free answers.
- Visionary already captures token/cost telemetry; next useful step is to expose a workflow-level baseline lens.

## Scope
- Add a small deterministic cost-baseline summarizer.
- Surface it through `/api/overview` for the dashboard.
- Add unit/smoke coverage.

## Acceptance checks
- `node --test tests/cost-baseline.test.mjs`
- `node --test tests/smoke.mjs`
- `npm run check`
- `git diff --check`
