# GSD Quick — Domain AI literacy workbench signal

## Trigger
Jake ingestion on 2026-08-28 added the `domain-ai-literacy-community-workbenches` concept: serious AI adoption needs domain judgment, use/non-use boundaries, peer discourse, embedded assistants, artifact ledgers, and implementation evidence.

## Small Visionary improvement
Extend Visionary's deterministic governance scanner so projects that look like domain-expert AI adoption work get a specific `domain_ai_literacy` workbench profile instead of only a generic governance nudge.

## Scope
- Update `src/governance.js` with a domain-literacy checklist and classifier.
- Update governance unit tests.
- Update docs catalog so future maintenance agents know this review surface exists.

## Verification
- `npm run check`
- `npm run test:unit`
- `npm run smoke` if time permits
- `git diff --check`
