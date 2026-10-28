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
9. **Blind local-fit tests beat leaderboards.** For subjective model/tool/provider choices, use the same local input, anonymized candidate outputs, pre-reveal human judgment, and an answer-key/tradeoff record before trusting brand, price, or public scores.
10. **Escalate automation deliberately.** Use `docs/AUTOMATION-TIMING-RUBRIC.md` before converting manual work into scripts, agents, crons, or first-class product integrations.
11. **Select the smallest effective interface layer.** Use `docs/INTERFACE-LAYER-SELECTION.md` before turning chat, co-work, IDE, terminal, or script-shaped work into custom orchestration.
12. **Use governance workbenches for consequential AI.** When project/task text points at affected users, education, sensitive domains, external customers, or AI decisioning, check `/api/projects/:id/governance` and create a decision ledger before productizing autonomy.
13. **Separate domain AI literacy from generic governance.** If the governance payload includes `workbench_profiles[].id === "domain_ai_literacy"`, treat the project as practitioner adoption work: name use/non-use boundaries, examples/anti-examples, peer review loops, artifact revisions, and consent/retention rules before building always-on automation.
14. **Expose post-digital governance surfaces.** If the governance payload includes `workbench_profiles[].id === "post_digital_governance_surface"`, map roles/identity, action rights, data classes, provider dependencies, source provenance, blast radius, audit, rollback, and incident ownership before expanding autonomy.
15. **Keep document collaboration artifact-centered.** When dispatching edits to specs, runbooks, briefs, proposals, templates, or reports, require a source discussion, active artifact, bounded role/output contract, section target, change ledger, and merge/review path before treating the result as final.
16. **Resume from position-addressed state.** When a request says continue, resume, follow up, hand off, unblock, or pick up a prior run, reconcile the relevant task/project status, source files, artifact workdir, logs, branch/commit, blockers, and verification trail before executing new work.
17. **Package work for the next surface.** When a request says export, convert, package, bundle, zip, publish, or hand off a deck/spec/report/folder, name the canonical source, target consumer/tool, output formats, continuation context, fidelity checks, and review path so Canva, PowerPoint, Claude Code, vendors, contractors, or clients can resume without chat archaeology.

18. **Build workflow skills as portable markdown first.** When dispatching work to create or improve a skill, SOP, playbook, checklist, template, prompt, or repeated process, require a canonical markdown source, scope boundaries, concrete procedure, examples/failure modes, at least one pressure-test case, and a revision loop before productizing the workflow.

19. **Keep generated media provenance folder-shaped.** When dispatching image, video, audio, ad, render, style-variant, or take-selection work, require source assets, prompt/spec ledger, tool/model metadata, variant notes, deterministic captions/text/export details, rights/approval assumptions, and a final package inventory before treating a generated asset as usable.

20. **Capture the workflow before automating it.** For a repeated job being automated, scheduled, or delegated to an agent, run the two-minute test (write the procedure, have a fresh reader follow it, mark the trip-ups), fill input/do/output/human-check, reproduce it in a fresh chat, and only then classify each step with `docs/AUTOMATION-TIMING-RUBRIC.md` — the missing written procedure is the bottleneck, not the model.

21. **Give code work a visible orient/plan/edit/verify loop.** For refactors, features, bug fixes, migrations, tests, or endpoints dispatched to a file-aware coding agent, require orientation from the repo front desk, a visible plan/search strategy, named target files plus forbidden areas and acceptance criteria, bounded edits with observable diffs, and real execution output (syntax/test/build/pipeline) before the result is trusted — a "looks correct" transcript is review debt, not verification.

22. **Automate to augment, not to replace.** When a request removes the human from a workflow — "autonomous", "hands-off", "unattended", "set-and-forget", "no human", "fully automated" — require the augmented human role and multiplied capacity, the structure supplied (context, memory, files, examples, review gates), the points where the human still steers (intake, exceptions, approval, final judgment), the verification and rollback path, and the one step — if any — that is genuinely safe to fully automate. Structure is the product; the riderless-automation claim is the weak version.

23. **Pick the next skill at the cross-domain overlap.** When choosing a learning or build target — "what should I learn/build next", "pick the next skill", "rank the roadmap" — list the domains the operator already carries, name the two domains the target sits between and the concrete transfer that discounts it, rank by transfer discount rather than generic value, keep genuinely orthogonal high-value skills as explicit exceptions, and capture each observed eureka in a dated ledger. Adjacency is a cost lens: the overlap you already have a head start in is the cheapest next step, and the boost should be recorded so it compounds.

24. **Decompose AI work into instructions, runner, state, and hand-back.** When a dispatch frames AI as the worker — "AI can do the work", "let AI handle it", "have AI do X", "now that AI can…" — require the instructions and where the why lives, the model/runtime named separately as the runner, the durable state that survives the run and who can inspect it, the human hand-back point (never "none"), and the ownership split between non-opinionated parts and the operator's own opinionated why. A program is instructions + a runner + surviving state; the model only fills the runner slot, so treating it as the whole program is the failure mode.

25. **Label all four augmentation means before shipping a capability.** When a dispatch adds a tool, feature, agent, or capability — "build a tool", "add a feature", "more agents", "build a connector", "we should augment…" — require each of Engelbart's four means labeled present, weak, or missing: artifacts (objects to work through), language (context packages, schemas, glossaries), methodology (SOPs, routing maps, gates, verification loops), and training (onboarding, examples, checklists, walkthroughs). Name the higher-order role the human owns after each automation step, expose primitives instead of a feature inventory, and state who is augmented plus the hand-back point. Tools alone do not augment; a missing means degrades to bare automation or tool-chasing — so build the missing means rather than adding more capabilities, and remember intelligence is the organization of complexity toward a goal, not the complexity itself.

26. **Encode org knowledge as a routable, bounded company brain.** When a dispatch builds an organization's knowledge — "company brain", "second brain", "knowledge base", "internal wiki", onboarding docs, or an internal assistant meant to answer "what should I do now?" — require the package parts: a responsibility map (who owns what, escalation paths), encoded SOPs/playbooks, request routing plus approval thresholds, a query surface with its allowed tools/permissions, a correction/memory loop so SOPs cannot go stale, a permission/provenance boundary so sensitive context cannot leak, review/telemetry for routing decisions, and an explicit hand-over of the maintenance loop. A company brain is a connectable, org-scoped, routable context package — not a chat window over loose documents; stopping at "ask questions in a chat" without moving the coordination rules into the system is the failure mode.

27. **Design person-facing surfaces to hand the capability back, not expose the stack.** When a dispatch designs or changes a surface a person works through — UI, screen, dashboard, layout, button, click, gesture, onboarding, operator interface, or a vague "make it easier / fewer steps / one click" — require the person/role the capability is handed back to and the capability gained, the compressed stack the surface hides (data, permissions, model calls, failure modes, operational state), the deliberate affordance decisions (which action is surfaced, how, and why), the hand-back line (what the person sees and controls versus internal machinery), how a broken or uncertain lower layer surfaces plus the recovery path, and a verdict judged by hand-back quality rather than machinery or monetizability. A user-facing affordance is the visible top of a stack that exists to augment a person, so do not read a simple gesture as a simple system and do not expose raw plumbing as the interface.

28. **Audit AI-written software before trusting or shipping it.** When a dispatch reviews, hardens, or ships software an AI wrote — "audit my app", "is this safe to ship", "review the code", "vibe coded", "check for secrets", "harden it before launch" — require the current-file secret scan plus Git/tool/deployment history review (with any un-inspectable history stated as a limitation), managed auth/session/provider primitives rather than hand-rolled JWT/crypto/session/password/webhook/permission code, the enumerated public route map with expected auth per method and a check that admin/ops/client data endpoints are not exposed, generated task plans/prompts/markdown/logs read as executable context for ambiguous instructions, the external provider/deployment boundary checked or its limitation stated, a human threat model for malicious/accidental/client misuse, and a risk report with findings, unresolved limitations, fixes made or recommended, and exact verification commands and results. A working app is not evidence that secrets, auth, route exposure, deployment config, and generated artifacts are safe, and a green build is not a security signal — `src/production-readiness.js#vibeCodedAudit` is the deterministic gate set and this nudge makes agents run it at dispatch time.

29. **Establish partitionability before fanning work out to agents.** When a dispatch splits work across multiple agents, workers, or people in parallel — "in parallel", "fan out", "concurrent", "swarm", "spawn several agents", "run agents in parallel", "orchestrate" — require the independent communication-free units (or state that they do not exist), an exclusive file/artifact/decision surface per worker, the coordination edges the workers must satisfy to finish (targeting zero), the coupled core that must stay single-threaded with its separate review pass, a progress metric of delivered verified slices rather than agent counts or tokens burned, and the placement decision (folders/owners/state) before automation. Parallelism only raises progress for partitionable, communication-free work; on coupled goals where "best" is relative, adding agents lengthens the path — so give a verdict of parallelize / serialize-to-one + review / split the independent slices and run the coupled core single-threaded.

30. **Establish instruction provenance before running borrowed instructions.** When a dispatch adopts instructions, prompts, skills, templates, or workflows written by someone other than the operator — "based on this repo", "copy this", "reuse the existing skill", "follow the template", "adapt this prompt", "generated by", "came with the vendor", "third-party workflow" — require the author of each instruction set in play (with un-establishable authorship recorded as a limitation), the split between opinionated parts (procedure, subject/identity, verb scope) and rentable non-opinionated parts (connectors, runtimes, tooling), the definition of what the instruction's verb asks for before handing it to a runner, and a provenance audit when output drifts off-spec rather than a model-blame. Instructions carry authorship, not just content: instructions written by an AI or another programmer make the work follow their rules and their opinion — so own the opinionated instructions and rent only the non-opinionated ones, with a verdict of keep-and-own / rewrite the opinionated parts / rent only the connectors.

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
