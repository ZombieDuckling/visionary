# Workbench-prerequisite gate dispatch nudge

## Context
Latest Jake Van Clief ingestion emphasized that “agents” are UX labels over prerequisites: procedure/skill, user or role context, connector access, permissions/read-back, cost limits, and governance.

## Small improvement
Add a deterministic prompt nudge that triggers on agent/workflow automation requests before dispatch, forcing the executable prerequisites to be named instead of letting the agent label stand in for product architecture.

## Acceptance checks
- Classifier ignores cosmetic agent UI changes.
- Classifier detects real agent/workflow work across inboxes, CRMs, tickets, repos, files, or tasks.
- Prompt block names procedure/skill, role context, access, permission/read-back, and cost/governance limits.
- Wire the nudge into server dispatch augmentation.
- Run targeted tests plus project verification.