# 2026-09-05 Downstream Export Nudge

## Trigger
Jake Van Clief ingestion highlighted a repeated product lesson: useful AI workbenches should export the same source work into the next practical surface — zip, deck, HTML, Canva, Claude Code, vendor docs, or contractor handoff — instead of trapping value in chat.

## Small change
Add a deterministic dispatch nudge for export/handoff-shaped requests. It should ask agents to name:
- canonical source artifact
- target consumer/tool
- required output formats
- continuation context
- fidelity checks
- review/open decisions

## Constraints
- No broad UI rewrite.
- No new dependencies.
- Keep original operator request first.
- Add focused unit coverage and wire into existing prompt augmentation pipeline.

## Verification
- `node --check src/downstream-export.js`
- `node --test tests/downstream-export.test.mjs`
- `npm run check`
- `npm run test:unit`
