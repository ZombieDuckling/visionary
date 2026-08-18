# 2026-08-18 Chat continuity pass

## Goal

Complete the small Argus chat continuity improvement already present in the working tree without broad rewrites: make session switching usable after replacing the native select, and make chat action execution deterministic/tested.

## Jake Van Clief influence

The latest ingestion emphasized three-layer context routing: a front-desk map, room/task context, and active files with read/use/verify rules. For Visionary, the highest-value small product mapping is the chat session surface: Argus conversations are the operator's front desk into agent orchestration, so switching/renaming sessions and executing task markers should be visible, durable, and test-backed rather than transient or one-off.

## Scope

- Preserve existing uncommitted chat-session work and finish it instead of restructuring.
- Keep changes local-first and zero-dependency.
- Add focused tests for the extracted chat action parser.
- Run syntax and unit verification before commit.
