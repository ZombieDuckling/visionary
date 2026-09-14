# 2026-09-14 — Source-map before search dispatch nudge

## GSD quick scope

Add one small deterministic dispatch nudge inspired by the latest Jake Van Clief ingestion batch: when an agent is asked to work across a repo/folder/workspace, it should build or read the smallest useful file tree/source map before broad searching or editing.

## Why

The `EXJJcBrgceg` lesson says folders, text, and components are routing context. Visionary already has provenance and workflow-map nudges, but it does not specifically tell agents to orient on the tree before repo/workbench tasks. This is a cheap reliability improvement with no schema/UI risk.

## Acceptance

- Add a standalone classifier/prompt module.
- Wire it into dispatch prompt augmentation.
- Add unit tests.
- Document it in README.
- Run verification and commit/push if clean.
