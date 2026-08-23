# GSD Quick — Context Boundary Dispatch

Date: 2026-08-23

## Trigger
Nightly background improvement pass for Visionary, informed by Jake Van Clief ingestion on prompt/context memory hierarchy.

## Goal
Make one small verified improvement that helps Visionary agents keep instruction, operator task, raw source, generated output, and tool-action boundaries separate.

## Scope
- Add a deterministic prompt augmentation module for context-boundary checks.
- Wire it into agent dispatch prompt construction.
- Add unit tests.

## Non-goals
- No database migration.
- No broad UI rewrite.
- No cron/job changes.

## Verification
- `npm run check`
- targeted unit tests
- full `npm run test:unit` if feasible
- git diff/status, commit, push
