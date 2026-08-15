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
5. **Model choice is contextual.** Match harness and agent role to the job-to-be-done, risk, cost, and data shape; do not assume the "best" model is always the right one.
6. **Truth decks beat vibes.** Reusable AI workflows should carry a few representative input/output cases with must-include, must-avoid, quality, latency, and cost expectations before prompts or providers are treated as production-ready.

## Good background-improvement targets

When doing autonomous maintenance, prefer changes that strengthen one of these workbench components without broad rewrites:

- Workspace continuity: better handoff docs, state summaries, stale-run cleanup, artifact indexes.
- Role/personality support: clearer agent charters, org-chart validation, role-to-workflow matching.
- Artifact visibility: better file lists, links, source provenance, or preview safety.
- Cost/token telemetry: capture, estimate, or expose usage without adding paid dependencies.
- Secret isolation and local-first safety: path guards, env documentation, retention checks.
- Reliability checks: focused tests, smoke scripts, route validation, syntax gates.
- Onboarding UX: front-desk pages, empty-state copy, operator runbooks.

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

Run `npm run verify` when touching runtime paths or before releases. If the working tree already contains unrelated user changes, avoid overwriting them and commit only the files you changed.
