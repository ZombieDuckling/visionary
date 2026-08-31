# GSD Quick: Post-digital governance surface

## Trigger
Jake Van Clief nightly ingestion added `post-digital-governance-and-cyber-power`: AI workbenches that shape identity, access, money, reputation, public decisions, infrastructure, or security posture need visible governance surfaces.

## Small improvement
Extend Visionary's deterministic governance scanner with a `post_digital_governance_surface` workbench profile when project/task text combines AI/action workflows with sensitive domains, external users, cyber/security, identity, money, data/privacy, or infrastructure risk.

## Boundaries
- No broad rewrite.
- Do not touch live SQLite state.
- Keep implementation deterministic and covered by node:test.

## Verification
- `node --test tests/governance.test.mjs`
- `npm run check`
- `git diff --check`
