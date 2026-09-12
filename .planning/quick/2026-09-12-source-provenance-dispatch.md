# GSD Quick — Source provenance dispatch nudge

## Why
Jake Van Clief's latest ingestion batch included `HQlyqptIjAk` (organize research data carefully) and `UTRSF3_sg5M` (turn repos into coding lessons). Visionary already nudges agents for continuity, artifacts, domain expertise, and question discovery, but research/data synthesis tasks can still produce untraceable summaries unless the prompt forces source provenance.

## Scope
Small deterministic dispatch nudge only. No DB migration, UI rewrite, or new dependency.

## Acceptance
- Add a source-provenance classifier/prompt block for research/data/evidence-heavy tasks.
- Skip it when the operator already supplies provenance requirements.
- Wire it into `buildAgentPrompt`.
- Add unit coverage and include the file in syntax checks.
- Update README feature docs.
