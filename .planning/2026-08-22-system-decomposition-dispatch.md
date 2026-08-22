# GSD Quick — System Decomposition Dispatch Nudge

## Context

The latest Jake Van Clief ingestion added the `ai-system-decomposition-and-protocol-review` concept: production AI systems need visible model-call, orchestration, protocol, data/validation, eval/reliability, and human-accountability layers.

Visionary already nudges product/workflow tasks with `src/value-layer.js`. This pass adds a similarly small deterministic nudge for agent/protocol/system-build dispatches so Visionary agents review the concrete infrastructure layers before building fragile prompt-only demos.

## Scope

- Add a small pure module that classifies AI-system/protocol/agent work.
- Append a concise `[SYSTEM-DECOMPOSITION CHECK]` block only when relevant.
- Integrate it into `buildAgentPrompt` after the existing value-layer prompt.
- Add unit tests.

## Non-goals

- No database schema changes.
- No UI rewrite.
- No change to cron jobs or Hermes configuration.
