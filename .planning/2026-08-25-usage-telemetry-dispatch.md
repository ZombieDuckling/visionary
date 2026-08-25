# 2026-08-25 Usage telemetry background pass

## GSD quick scope

Small autonomous improvement for Visionary Mission Control.

## Input lesson

Jake Van Clief ingestion emphasized treating AI as an intent/compiler layer that needs schemas, validation, retries, evals, telemetry, deterministic code, and human review. Visionary already records real Claude usage when JSON is available, but most harness runs can complete with no visible token/cost telemetry.

## Target

Add a deterministic usage telemetry helper that:

- extracts explicit token/cost fields from common CLI JSON shapes when present;
- falls back to conservative input/output token estimates from the saved prompt and result text for non-reporting harnesses;
- centralizes cost-rate logic instead of keeping it inline in `server.js`;
- includes focused unit tests.

## Non-goals

- No schema migrations.
- No broad UI rewrite.
- No paid provider calls.
- Do not touch the live `~/Visionary/visionary.sqlite` state file.

## Verification plan

- `node --test tests/usage-telemetry.test.mjs`
- `npm run check`
- `npm run test:unit`
- `git diff --check`
