# Visionary Automation Timing Rubric

Visionary should not turn every idea into an autonomous agent loop. Use this rubric when adding workflows, chat actions, crons, dispatch paths, or UI controls.

## Escalation ladder

| Level | Use when | Visionary surface | Human checkpoint |
|---|---|---|---|
| 0. Manual note | The workflow is unclear, rare, risky, or still being learned. | Docs, task description, artifact note. | Josh decides the next action explicitly. |
| 1. Copy/paste assist | The work benefits from AI wording but the operator should execute it. | Argus chat response, runbook snippet, checklist. | Operator reviews before running. |
| 2. Deterministic helper | The steps are repeatable and low-risk. | `scripts/`, API route, prepared statement, validation command. | Script output includes enough evidence to verify. |
| 3. One-shot agent dispatch | The work needs judgment but has a bounded deliverable. | Kanban dispatch, `/api/agents/:id/dispatch`, task artifact directory. | Runs & Artifacts plus review verdict. |
| 4. Scheduled automation | The work is recurring, idempotent, and safe to retry. | `src/scheduler.js`, Crons tab, watchdog logs. | Status row, last-run output, and failure path are visible. |
| 5. Productized integration | The workflow is central enough that users should not think about mechanics. | First-class UI, persisted settings/state, tests, docs. | Onboarding copy and regression tests protect it. |

## Promote only when these are true

- **Trigger clarity:** Visionary can tell when the workflow should start without guessing.
- **Input boundaries:** Required files, task IDs, agent IDs, secrets, and workspace paths are explicit.
- **Failure shape:** Common failures have deterministic handling, not silent hallucinated success.
- **Review surface:** The operator can inspect what happened: logs, artifacts, status, costs, or links.
- **Reversibility:** The action is read-only, idempotent, or has a bounded undo/retry path.
- **Cost/risk fit:** Agent autonomy is worth the token, latency, and data-exposure cost.

## Demotion triggers

Move a workflow down the ladder when it starts producing unclear artifacts, repeated review failures, surprise spend, ambiguous ownership between agents, or actions that Josh needs to manually undo.

## Design implication for Visionary

New features should expose the ladder explicitly where possible: prefer buttons that create reviewable tasks before adding autonomous crons, prefer scripts before agents for deterministic maintenance, and keep high-risk connectors behind visible settings and logs.
