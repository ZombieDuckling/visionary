# GSD Quick: Question-first discovery dispatch nudge

- Started: 2026-09-11 04:46:21 SAST
- Scope: Add a small deterministic dispatch nudge for underdefined discovery/diagnosis/client/product requests.
- Source lesson: Jake Van Clief `d8Bwzvyeq2M` — prompts should sometimes extract sharper questions before execution, because answers are cheap and wrong execution creates rework.
- Acceptance:
  - New classifier/prompt helper has unit coverage.
  - Dispatch pipeline appends the helper before broad challenge-design quality nudges.
  - README documents the operator-visible behavior.
  - Relevant checks pass.
