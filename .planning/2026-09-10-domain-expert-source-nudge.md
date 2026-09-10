# 2026-09-10 Domain-expert source nudge

## GSD quick scope

Jake Van Clief ingestion highlighted: subject experts beat generic AI experts when workflows depend on real leases, reports, compliance, outreach, local context, or operational judgment.

## Small improvement

Add a deterministic dispatch nudge that triggers when a Visionary task asks agents to build/automate/design AI workflows in a domain-specific setting. The nudge should make the agent gather domain artifacts, examples, edge cases, owner/reviewer, and acceptance criteria before inventing a solution.

## Acceptance checks

- Unit tests cover ignore/detect/prompt/append behavior.
- Server dispatch prompt chain includes the nudge.
- README documents the feature.
- Existing verification passes.
