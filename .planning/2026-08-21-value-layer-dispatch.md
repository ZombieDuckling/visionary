# 2026-08-21 — Value-layer dispatch nudge

## Trigger

Background autonomous improvement pass after Jake Van Clief ingestion processed the abstraction-layer value-capture lesson.

## Goal

Make Visionary's agent dispatches slightly better at product/workflow tasks by nudging applicable agents to identify the abstraction layer, commoditization risk, defensible context, prototype layer, and telemetry/review loop.

## Scope

- Add a small deterministic classifier/formatter for value-layer advice.
- Inject it into dispatched agent prompts only when the task text looks like product/workflow/design/build/automation strategy work.
- Add unit tests.
- Avoid schema changes and broad UI rewrites.

## Verification

- `node --check server.js`
- `node --test tests/value-layer.test.mjs`
- `npm run check`
- `npm run test:unit`
