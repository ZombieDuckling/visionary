# Coding-agent loop nudge

## Goal
Apply Jake Van Clief's coding-agent plan/edit/verify loop concept (videos `v2UnNFmkia0`, `rHDA0WMXzy4`, `0fCQ-4J_jzk`, `_rtyhVD4v4A`) to Visionary's dispatch prompts with the smallest deterministic improvement.

## Scope
- Add `src/coding-agent-loop.js`: a deterministic nudge for code work dispatched to a file-aware coding agent (Claude Code, Cursor, Codex, or an autonomous dispatcher).
- Require orient (repo front desk) → visible plan/search strategy → scoped edit (target files, forbidden areas, acceptance criteria) → real verification (syntax/test/build/pipeline output) → report (changed files, failures, cost, next edit) → persist state.
- Wire into the dispatch prompt-augmenter chain, add focused tests and docs.
- Avoid database, UI, runtime, or schema rewrites.

## Why it matters
Visionary's core use is dispatching coding agents. The failure mode Jake names is autonomy without the loop: a copied-over or "looks correct" edit treated as a verified result. Forcing a visible plan, scope, and real execution output keeps coding dispatch reviewable and protects dispatch output quality.

## Verification
- `node --check src/coding-agent-loop.js`.
- Unit tests for classifier + prompt block behavior.
- `git diff --check`, plus the focused test file.
