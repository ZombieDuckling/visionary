# GSD quick — portable instruction asset nudge

## Intent
Add one small Visionary improvement from the latest Jake Van Clief ingestion: when an agent/workflow request smells like a wrapper/framework/harness build, nudge the dispatched agent to capture the valuable workflow as a portable instruction asset first.

## Acceptance checks
- Deterministic classifier + prompt block covered by node:test.
- Prompt augmentation wired into dispatch path.
- Syntax/test verification passes.
- Commit and push only if verified.
