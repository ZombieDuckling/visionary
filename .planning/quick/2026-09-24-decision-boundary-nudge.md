# Decision-boundary dispatch nudge

## Context
Latest Jake Van Clief ingestion emphasized separating AI capability claims, ethics/risk judgments, human responsibility chains, and human-support boundaries.

## Small improvement
Add a deterministic prompt nudge that triggers on AI/product decisions where capability, ethics, deployment, responsibility, or emotional-support boundaries are likely to be conflated.

## Acceptance checks
- New classifier ignores ordinary work.
- Classifier detects capability-vs-ethics/deployment-boundary prompts.
- Prompt block names capability evidence, ethics/risk, deployment owner, human boundary, and verification.
- Wire the nudge into server dispatch augmentation.
- Run targeted tests plus project verification.
