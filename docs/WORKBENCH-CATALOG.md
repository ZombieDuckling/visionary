# Visionary Workbench Catalog

Visionary is easier to improve when the repo is treated as an AI workbench instead of a pile of agents. This catalog is the front desk for humans and maintenance agents: start here to find the right surface before changing code.

## Component map

| Workbench component | Visionary surface | Primary files | What to check before editing |
|---|---|---|---|
| Front desk | Product orientation and operator entry points | `README.md`, `HANDOFF.md`, this file | Does the change help a first-time operator know where to start? |
| Catalog | Source-of-truth maps for agents, routes, tabs, and runtime shape | `personalities/org-chart.json`, `README.md`, `HANDOFF.md`, `db.js` prepared statements | Is there one durable place future agents can inspect before guessing? |
| Request slips | Deterministic actions the operator can ask Visionary to run | API routes in `server.js`, scripts in `scripts/`, cron schedules in `src/scheduler.js` | Could this be a small script/route instead of an agent loop? |
| Source material | Personality charters, task artifacts, project/workspace data | `personalities/agents/*.md`, `~/Visionary/<project>/task-<id>`, SQLite rows | Is output linked back to evidence the operator can inspect? |
| Librarian / model layer | Harness adapters and failover routing | `src/runtimes/*.js`, `src/runtimes/failover.js`, agent `harness_chain` config | Is model choice contextual and recoverable if one harness fails? |
| Durable state | Local SQLite state and filesystem artifacts | `db.js`, `visionary.sqlite`, `sse.js`, artifact directories | Is the result written somewhere other than transient chat? |
| Review surface | Human verification, logs, artifacts, tests | task detail Runs & Artifacts, `tests/`, `npm run verify`, dispatch drawer | Can Josh see what happened, what changed, and whether it passed? |
| Boundary layer | Local-first safety, secrets, costs, retention | env vars in `README.md`, `src/guardrails.js`, `src/cleanup.js`, runtime adapters | Does it preserve local-first behavior and avoid surprise spend/leaks? |

## Maintenance heuristics

1. **Prefer the smallest deterministic surface.** If a workflow is repeatable, make it a script, route, prepared statement, or UI affordance before adding agent autonomy.
2. **Catalog before context flood.** Future agents should be able to read a map first, then the relevant source files, rather than loading the whole repo.
3. **Durable write-back matters.** Useful outcomes should land in SQLite, artifacts, docs, or personality/config files — not just chat history.
4. **Every automation needs a review surface.** Add links, file lists, log snippets, test output, timestamps, or status rows so the operator can verify.
5. **Move up abstraction layers before productizing.** For product/workflow dispatches, identify the cheap raw-output layer, defensible context, smallest prototype, and telemetry/review loop before treating a feature as a moat.
6. **Model choice is contextual.** Match harness and agent role to the job-to-be-done, risk, cost, and data shape; do not assume the "best" model is always the right one.
7. **Truth decks beat vibes.** Reusable AI workflows should carry a few representative input/output cases with must-include, must-avoid, quality, latency, and cost expectations before prompts or providers are treated as production-ready.
8. **Run matrices beat anecdotes.** Evaluation and research dispatches should name the model/provider/persona/prompt/case variables, deterministic parsing/scoring rules, exports, and failure data before drawing conclusions.
9. **Escalate automation deliberately.** Use `docs/AUTOMATION-TIMING-RUBRIC.md` before converting manual work into scripts, agents, crons, or first-class product integrations.
10. **Select the smallest effective interface layer.** Use `docs/INTERFACE-LAYER-SELECTION.md` before turning chat, co-work, IDE, terminal, or script-shaped work into custom orchestration.
11. **Use governance workbenches for consequential AI.** When project/task text points at affected users, education, sensitive domains, external customers, or AI decisioning, check `/api/projects/:id/governance` and create a decision ledger before productizing autonomy.
12. **Separate domain AI literacy from generic governance.** If the governance payload includes `workbench_profiles[].id === "domain_ai_literacy"`, treat the project as practitioner adoption work: name use/non-use boundaries, examples/anti-examples, peer review loops, artifact revisions, and consent/retention rules before building always-on automation.
13. **Expose post-digital governance surfaces.** If the governance payload includes `workbench_profiles[].id === "post_digital_governance_surface"`, map roles/identity, action rights, data classes, provider dependencies, source provenance, blast radius, audit, rollback, and incident ownership before expanding autonomy.
14. **Keep document collaboration artifact-centered.** When dispatching edits to specs, runbooks, briefs, proposals, templates, or reports, require a source discussion, active artifact, bounded role/output contract, section target, change ledger, and merge/review path before treating the result as final.
15. **Resume from position-addressed state.** When a request says continue, resume, follow up, hand off, unblock, or pick up a prior run, reconcile the relevant task/project status, source files, artifact workdir, logs, branch/commit, blockers, and verification trail before executing new work.
16. **Package work for the next surface.** When a request says export, convert, package, bundle, zip, publish, or hand off a deck/spec/report/folder, name the canonical source, target consumer/tool, output formats, continuation context, fidelity checks, and review path so Canva, PowerPoint, Claude Code, vendors, contractors, or clients can resume without chat archaeology.

## Good background-improvement targets

When doing autonomous maintenance, prefer changes that strengthen one of these workbench components without broad rewrites:

- Workspace continuity: better handoff docs, state summaries, stale-run cleanup, artifact indexes.
- Role/personality support: clearer agent charters, org-chart validation, role-to-workflow matching.
- Artifact visibility: better file lists, links, source provenance, or preview safety.
- Cost/token telemetry: capture, estimate, or expose usage without adding paid dependencies.
- Challenge-design quality bars: broad AI output prompts should name audience, stale baseline, rubric, evidence, examples, and acceptance criteria before agents produce generic work.
- Secret isolation and local-first safety: path guards, env documentation, retention checks.
- Reliability checks: focused tests, smoke scripts, route validation, syntax gates.
- Onboarding UX: front-desk pages, empty-state copy, operator runbooks.
- Automation timing: make the manual → copy/paste → script → agent → cron → productized integration ladder explicit so Visionary does not over-automate fragile workflows.

## Truth deck sketch for reusable workflows

Use `src/production-readiness.js#validateTruthDeck` as the deterministic baseline before making a workflow template, role, or prompt chain feel permanent:

```js
{
  goal: 'Workflow outcome this deck protects',
  cases: [{
    name: 'Representative case name',
    input: 'Input/context the workflow receives',
    expected_output: 'Characteristics of a good result',
    must_include: ['Evidence or fields that must appear'],
    must_avoid: ['Failure modes, leaks, or unwanted behavior'],
    quality_threshold: 'Human-readable pass condition',
    latency_target: '< optional target',
    cost_target: '< optional target'
  }]
}
```

This is intentionally small: start with handpicked examples, then expand only when regressions become costly.

## Quick verification path

```bash
npm run workspace-map
npm run check
npm run smoke
npm run test:unit
```

`npm run workspace-map` prints the position-addressed map of Visionary's front desk, role files, runtime adapters, durable state, UI, automation, review surface, and boundary layer. It exits non-zero if a mapped path disappears, so it is a cheap continuity check before deeper debugging.

`docs/AUTOMATION-TIMING-RUBRIC.md` is the escalation checklist for deciding whether a workflow should remain manual, become a deterministic helper, be dispatched to an agent, run on a schedule, or become a first-class product integration.

Run `npm run verify` when touching runtime paths or before releases. If the working tree already contains unrelated user changes, avoid overwriting them and commit only the files you changed.
