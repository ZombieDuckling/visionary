# 2026-08-27 Governance Watchlist Pass

## Trigger
Background Visionary maintenance run after Jake Van Clief ingestion batch on participatory AI governance workbenches.

## Small target
Add a deterministic governance/readiness watchlist surface for projects whose descriptions/tasks imply affected users, education, finance, security, customers, communities, or other higher-trust contexts.

## Acceptance
- No broad rewrite or schema migration.
- Source is project/task text already in local SQLite.
- `/api/overview` exposes a bounded `governance_watchlist`.
- `/api/projects/:id/governance` exposes per-project triggers/checklist.
- Overview UI shows the watchlist when it has hits.
- Tests cover deterministic analysis and API shape.
