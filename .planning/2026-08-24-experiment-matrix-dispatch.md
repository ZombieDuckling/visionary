# GSD Quick: Experiment matrix prompt guard

## Why
Jake Van Clief's model-behavior pipeline lesson says evaluation/research work should be handled as an explicit run matrix with deterministic parsing, exports, and failure accounting rather than one-off chat impressions.

## Scope
Small Visionary background improvement: add a deterministic prompt augmentation for dispatches that ask agents to compare/evaluate/research models, personas, prompts, scales, or experiments. Keep it narrow and verified with node:test.

## Touch points
- `src/experiment-matrix.js`
- `tests/experiment-matrix.test.mjs`
- `server.js` prompt composition
- `docs/WORKBENCH-CATALOG.md` maintenance heuristic

## Verification
- `npm run check`
- `npm run test:unit`
- `git diff --check`
