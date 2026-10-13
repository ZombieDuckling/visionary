# Quick pass: scoped memory routing nudge

## Goal
Add a small deterministic dispatch nudge that catches requests to save preferences/procedures/memory and forces agents to route them to the smallest correct scope instead of dumping them into global memory or hidden chat context.

## Jake input
Jake Van Clief ingestion highlighted that many “AI forgot my preference” failures are context-boundary failures. The fix is scoped routing: global memory only for global facts, project docs for project rules, skills/procedures for repeatable methods, workbench folders for task examples, and raw archives for evidence.

## Scope
- Add a focused prompt augmenter for memory/preference/procedure capture work.
- Wire it into dispatch prompt construction.
- Add unit coverage and include it in syntax checks.
