# Visionary Mission Control

[![CI](https://github.com/ZombieDuckling/visionary/actions/workflows/test.yml/badge.svg)](https://github.com/ZombieDuckling/visionary/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node 22 LTS](https://img.shields.io/badge/Node-22%20LTS-green.svg)](https://nodejs.org)

One operator. A full org of AI agents. One dashboard.

Visionary is a local-first mission control that orchestrates a 16-node AI organization — CEO Argus down through four directors to eleven ICs — dispatching kanban tasks across OpenClaw, Claude Code, Hermes, Codex, Cursor, Gemini, and Ollama. If a harness hits a rate limit or quota wall, the failover engine quietly replays the context on the next harness in the chain. You watch live-streamed output in the dispatch drawer, and when the task finishes, every file it produced is waiting in `~/Visionary/<project>/task-<id>` — openable directly from the dashboard.

## Why

Most agent dashboards are SaaS, cloud-bound, and assume a team. Visionary assumes one operator on one machine.

- **Local-first** — the server binds `127.0.0.1`. Nothing leaves your laptop.
- **One SQLite file** — all state lives in `visionary.sqlite`. Copy it, back it up, or inspect it with any SQLite browser.
- **One npm dependency** — `better-sqlite3`. No framework, no ORM, no build step. Electron and electron-builder are devDeps; they never touch production.

## Features

### Org chart and harness failover

`personalities/org-chart.json` declares the full organization as config: CEO (Argus) → four directors → eleven ICs, each node carrying a `harness_chain`, watchdog flags, and a path to its personality charter. On every server boot the schema is reconciled without losing runtime state.

When you dispatch a task the failover engine (`src/runtimes/failover.js`) walks the agent's `harness_chain` in order. Exhaustion signals — rate limits, quota errors, 429s, weekly limits, insufficient credit — are distinguished from hard failures. If a CLI is not installed (`ENOENT`) the engine skips that harness silently. On failover, the last N turns are replayed as context so the incoming harness picks up mid-conversation. When all harnesses are exhausted the task stays in Review for the operator.

Seven adapters are registered: `openclaw`, `claude` / `claude-code`, `hermes`, `cursor`, `codex`, `gemini`, `ollama`. Each implements `{ buildCommand, dispatch, kill, healthcheck }`.

### Task artifacts

Every dispatch runs inside its own working directory: `~/Visionary/<project>/task-<id>`. The run record stores the workdir path and a JSON file list of every file produced. The task detail panel shows a Runs & Artifacts section with live output, the file list, an Open Folder button, and click-to-open for individual files. Symlink escapes and executable bundles are rejected at the API layer.

### Auto-review with evidence

After a run completes, the reviewer agent runs through its own harness chain with the artifact list as evidence and read-only tools. Reviews parse a structured `APPROVE:` / `REJECT:` first line — no keyword-anywhere false verdicts. Inconclusive results stay in Review for the operator. Rejections redispatch through the normal path (new workdir, full failover). Tasks that hit the retry ceiling stay in Review rather than bouncing back to todo.

### Question-discovery dispatch nudges

Underdefined discovery, diagnosis, intake, client, product, workflow, or automation requests now get a deterministic question-discovery block before dispatch. The agent must extract the sharper question or decision, known facts/sources, unknowns/constraints, assumptions/non-goals, and a verification path before executing. It is intentionally skipped when the operator already supplied a discovery frame.

### Challenge-design dispatch nudges

Broad prompts like “draft a quick plan” or “generate ideas” now get a deterministic challenge-design block before dispatch. The nudge tells the agent to name the audience, avoid the stale/easy generic baseline, add a compact rubric, use evidence/examples, and still deliver without asking for clarification. It is intentionally skipped when the operator already supplied concrete quality criteria.

### Continuity dispatch nudges

Requests that say “continue”, “resume”, “pick up”, “handoff”, “follow up”, or “unblock” now get a deterministic continuity block before dispatch. The agent is told to recover the smallest useful prior state — task/project status, source files, workdir/artifacts, logs, branch/commit, blockers, and verification trail — before doing new work. This keeps long-running work anchored to durable state instead of stale chat memory.

### Folder-product baseline nudges

Product/app/agent build requests now get a deterministic folder-product baseline check. Before building custom infrastructure, the agent must name the smallest folder/workbench + markdown/context/artifact setup that could solve the job, then justify any software layer by the gap plain files cannot cover: roles, permissions, privacy, shared access, continuity, audit, artifact visibility, integrations, scheduling, or live status. This keeps Visionary focused on deployment/governance value instead of wrapping what a well-routed folder already does.

### Workflow-map nudges

Team/workflow/role/context-memory requests now get a deterministic workflow-map check. The agent must briefly name the nouns and verbs before acting: actors/nodes, actions/edges, inputs/outputs, source-of-truth files/state, and a verification path for a fresh operator or agent. This applies Jake Van Clief's second-brain lesson without adding a premature graph database or UI layer.

### Agent-split nudges

Agent/persona/org-design requests now get a deterministic split-justification check before dispatch. The agent must say what actually requires a distinct agent — authority, ownership, tool access, secrets, watchdog cadence, review duty, cost/latency profile, or user-facing identity — and name the simpler folder/workbench/router/script alternative when one would do. This keeps Visionary's role support grounded in workflow boundaries instead of prompt-theater swarms.

### Workflow-skill template nudges

Requests that ask Visionary agents to create or improve a skill, SOP, playbook, checklist, template, prompt, or repeatable workflow now get a deterministic reusable-workflow block before dispatch. The agent must name the canonical markdown source, scope boundaries, procedure, examples/failure modes, pressure-test case, and revision loop before producing another one-off answer. This applies the “skills are markdown” / “build once, never start from scratch” lesson without turning every workflow into a platform feature.

### Opinion-standard nudges

Requests that ask agents to encode taste, preferences, principles, rubrics, style guides, or review criteria now get a deterministic opinion-standard block before dispatch. The agent must anchor the standard in source evidence, name the decision boundary, include examples and anti-examples, provide a small review rubric, and leave a revision path. This applies Jake Van Clief's “automate your opinions” lesson: judgment becomes durable operating material instead of disposable chat tone.

### Asset-workbench nudges

Brand/design/media asset requests now get a deterministic asset-workbench block before dispatch. The agent must inventory source assets, keep originals separate from generated outputs, map brand rules/examples/components/scripts, capture taste constraints, stage deck/site/animation pipelines, and leave portable source plus rendered/exported files. This applies Jake Van Clief's Claude Design import/export lesson: spend model effort once on an exportable workbench instead of repeatedly rediscovering context inside a hosted UI.

### Downstream export nudges

Export/package/handoff requests now get a deterministic downstream-export block before dispatch. The agent must name the canonical source artifact, target consumer/tool, output files or formats, continuation context, fidelity checks, and review path. This keeps decks, specs, HTML, zips, Canva/PowerPoint packages, Claude Code handoffs, and vendor bundles portable instead of trapped in chat.

### Opportunity-routing nudges

Client/customer/market workflow requests now get a deterministic opportunity-routing block before dispatch. The agent must name the buyer/user, current time or money cost, fulfillment capacity and routing path, reusable asset to save, and proof-of-work before recommending broader product buildout. This applies Jake Van Clief's paid-pain lesson: Visionary agents should route real demand to capable operators before turning AI novelty into software.

### Domain-expert source nudges

Domain-specific AI/workflow requests now get a deterministic domain-expert-source block before dispatch. The agent must name the practitioner or accountable reviewer, source artifacts, edge cases, AI-assist versus human-only boundaries, and acceptance/sign-off criteria before building automation. This applies Jake Van Clief's subject-experts-beat-AI-experts lesson: Visionary should help experts package their judgment, not let generic AI fluency pretend to replace it.

### Source-provenance nudges

Research, data, transcript, archive, repository, audit, report, or knowledgebase synthesis requests now get a deterministic source-provenance block before dispatch unless the operator already supplied one. The agent must preserve source inventory, transformations, confidence/gaps, reusable structure, and verification checks before producing findings. This applies Jake Van Clief's research-data-care lesson: AI-organized knowledge is only useful if the next operator can trace conclusions back to real sources.

### Source-map before search nudges

Repo, folder, project, component, script, docs, artifact, or workbench requests now get a deterministic source-map block before dispatch unless the operator already supplied a file-tree/routing frame. The agent must read an existing README/HANDOFF/manifest/index first, name the relevant tree, search from likely paths before broadening, preserve exact paths in handoffs, and verify that cited/generated file references exist. This applies Jake Van Clief's folder-tree lesson: paths are low-cost routing context, not decoration.

### Source-runtime value nudges

Source-code, template, clone, fork, import, migration, or leaked-code requests now get a deterministic source-runtime value block before dispatch. The agent must name the reused source/provenance limits, runtime wiring, workflow fit, delivery proof, and value boundary before treating copied code as useful software. This applies Jake Van Clief's source-leak lesson: code capture is not product capture without deployment, data, permissions, operations, and customer/workflow fit.

### Interface-boundary nudges

API, CLI, tool, webhook, route, schema, adapter, or integration requests now get a deterministic interface-boundary block before dispatch when boundary or verification signals are present. The agent must name the exact contract surface, inputs/outputs, permission and secret boundary, read-back/smoke/schema verification, and failure behavior. This applies Jake Van Clief's abstraction-and-verification lesson: interfaces are contracts, confidence is not correctness, and secrets stay isolated from auditable workbench artifacts.

### Learning-loop nudges

Learning, teaching, training, tutorial, course, or onboarding requests now get a deterministic learning-loop block before dispatch unless the operator already supplied exercises, feedback, or proof criteria. The agent must name the target skill, starting-level assumption, active reps, feedback path, and transfer proof before producing learning material. This applies Jake Van Clief's “no AI cheat code for learning fast” lesson: Visionary should help agents turn explanations into practice loops and evidence, not passive summaries.

### Durable-retrospective nudges

Requests that revisit old AI/product plans, predictions, docs, roadmaps, or strategy now get a deterministic durable-retrospective block before dispatch. The agent must name the original claim/context, what held up as a durable principle, what changed in tools/market/workflow/assumptions, and whether to keep, revise, archive, or retest each major claim. This applies Jake Van Clief's retrospective lesson: Visionary should preserve transferable primitives without pretending stale tactics are still current.

### Failure-study nudges

Debug, incident, broken-build, and recurring-failure requests now get a deterministic failure-study block before dispatch. The agent must collect evidence first, name the missing concept or invariant the failure exposed, make the smallest safe fix, verify it, and save or propose one reusable test/checklist/runbook note. This applies Jake Van Clief's “failure shows what to study” lesson without turning every bug into a long postmortem.

### Replicability nudges

Delivery, ops, deployment, automation, scheduled, or handoff requests that mention repeatability, reruns, fallback, proof, logs, commands, or verification now get a deterministic replicability block before dispatch. The agent must name the inputs/environment, exact repeatable path, redundancy/fallback option, and proof artifact/output before calling the work done. This applies Jake Van Clief's redundancy/replicability lesson: useful work should survive the next run, provider failure, or fresh operator without relying on the original chat.

### Workflow-resilience nudges

AI/provider/tool-dependent workflow requests that mention outage, quota, failover, backup, model swaps, local/manual fallback, portable state, or degradation now get a deterministic workflow-resilience block before dispatch. The agent must name the resume state, next provider/model/tool, local/manual fallback, contract boundary, verification path, and safe degradation behavior. This applies Jake Van Clief's provider-resilience lesson: model swaps should be boring, and critical work should not depend on one chat surface.

### Baseline-ratchet nudges

Workflow/product/process improvement requests now get a deterministic baseline-ratchet block before dispatch unless the operator already supplied a baseline frame. The agent must name the old/manual baseline, the current AI baseline that has become cheap or table-stakes, the raised human+AI expectation, and the verification proof that the bar actually moved. This applies Jake Van Clief's “we forget what we already use is magic” lesson: Visionary agents should turn normalized AI capabilities into boring infrastructure and aim at the next useful workflow leverage point.

### Cron scheduler

`src/scheduler.js` parses standard five-field cron expressions. The tick runs every 60 seconds inside `server.js` and routes each firing through `executeWithFailover`, so scheduled runs get the same harness chain and failover behavior as manual dispatches. Manage schedules from the Crons tab or via `GET|POST|DELETE /api/schedules`.

### Cost capture

The Claude adapter dispatches with `--output-format json` and extracts real `input_tokens`, `output_tokens`, and `total_cost_usd` from the harness response. Non-reporting harnesses now get deterministic prompt/output token estimates from the saved run message and result text, so every completed run has at least an operator-visible usage signal in `agent_runs`. Estimated costs are deliberately rough and labeled by the existing `estimated_cost_usd` field.

The Overview API also returns `cost_baseline`: a local 30-day comparison of agent-run spend against an explicit human-time baseline (default 15 minutes per completed run at $75/hour). This follows the practical cost lens: compare AI spend to the real manual/search/review alternative, not to a fake zero-cost baseline.

### Governance watchlist

`src/governance.js` scans local project/task text for affected-user, sensitive-domain, education, AI-decisioning, trust/adoption, external-workflow, and domain-literacy signals. `/api/overview` returns a bounded `governance_watchlist`, and `GET /api/projects/:id/governance` returns the full deterministic trigger list plus lightweight decision-ledger guidance. When the text looks like practitioners adopting AI in a domain, the payload includes a `domain_ai_literacy` workbench profile with use/non-use boundaries, examples/anti-examples, peer review loops, artifact revision evidence, and consent/retention checks. When sensitive AI workflows may affect identity, access, money, reputation, security posture, or external decisions, the payload includes a `post_digital_governance_surface` profile that forces role/action rights, data classes, provider dependencies, source provenance, blast radius, audit, rollback, and incident ownership into view. This is intentionally advisory: it does not block work, but it nudges consequential AI/customer/team workflows toward named stakeholders, proposal ranking, implementation rationale, and eval cases before autonomy is productized.

### Watchdog

`watchdog.py` is an independent Python process that polls `/api/org` every 60 seconds. It decides per-agent whether to trigger a health-check (`POST /api/agents/:id/health-check`) or log a stale-activity warning. Each adapter's `healthcheck()` probes the actual CLI binary. The boot banner reports which harnesses are available.

### Prompt guardrails

`src/guardrails.js` provides canary token injection and detection, jailbreak regex scanning (ten patterns), token estimation, budget reporting, and context selection for failover replay. Guardrails are available to any dispatch path.

### Deep research

`POST /api/research { agent_id, question, max_queries }` runs a decompose → per-sub-query investigate → synthesize pipeline through `src/deep-research.js`. Each investigation leg goes through `executeWithFailover` independently.

### Streamed output

Dispatch output arrives over SSE (`agent:output`, `agent:harness` event types) and renders live in the dispatch drawer with a failover-position indicator. A kill switch cancels the run without triggering failover.

### PWA

Visionary is installable as a Progressive Web App. On Chrome desktop, look for the install icon in the address bar. On iOS Safari, tap Share and choose "Add to Home Screen". The static shell is cached for offline use; API calls remain network-first; `/api/events` is never cached.

## Quick start

```bash
git clone https://github.com/ZombieDuckling/visionary.git
cd visionary
./install.sh        # installs deps, compiles the native binding, links `vision` onto PATH
vision              # opens http://127.0.0.1:3333 in your browser
```

The `vision` command works from any directory once installed:

```bash
vision              # open the dashboard in your browser
vision start        # start the background server (and watchdog) via launchd or plain nohup
vision stop         # stop the background server
vision restart      # restart server and watchdog
vision status       # is it running?
vision logs         # tail ~/.visionary/server.log
vision app          # launch the Electron desktop shell (legacy)
```

Plain npm still works if you prefer:

```bash
npm install && npm start   # server on http://127.0.0.1:3333
```

`npm start` is self-healing: the `prestart` preflight (`scripts/ensure-native.js`) checks that the `better-sqlite3` native binding loads under the current Node ABI and rebuilds it once automatically if it does not match.

For the optional agent bridge:

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
npm run bridge
```

## Configuration

All paths are overridable via environment variables — no hardcoded user directories.

| Env var | Default | What it sets |
|---|---|---|
| `PORT` | `3333` | HTTP port |
| `VISIONARY_WORKSPACE` | `$HOME/.openclaw/workspace` | Where agent briefs, memory, and portfolio live |
| `VISIONARY_NODE` | `process.execPath` | Node binary the Electron shell uses to spawn the server |
| `VISIONARY_ARTIFACTS` | `$HOME/Visionary` | Root directory for per-task working directories |

The Settings tab lets you configure port, workspace path, theme, and default runtime from the UI. Changes persist in SQLite via `GET /api/settings` and `PUT /api/settings`. Theme changes apply immediately; port and workspace changes require a restart.

## Architecture

The server is `server.js` — all HTTP routes, the scheduler tick, and the cleanup tick run in one Node process. `db.js` holds the entire schema and every prepared statement; no SQL appears in route handlers. `sse.js` is the event bus and client registry. The org chart is config-as-code in `personalities/org-chart.json` and is reconciled into the `agents` table on every boot.

```
visionary/
├── server.js              # HTTP + SSE + API routes + scheduler tick + cleanup tick
├── db.js                  # Schema migrations (version 6) + prepared statements + org-chart bootstrap
├── sse.js                 # Event bus + client registry
├── electron.js            # Electron desktop shell
├── bridge.py              # Inter-agent message bridge (port 3335)
├── watchdog.py            # Independent Python watchdog process
├── public/                # Vanilla JS SPA — index.html, app.js, styles.css, sw.js
├── src/
│   ├── runtimes/          # Harness adapters + failover engine
│   ├── guardrails.js      # Canary tokens, jailbreak detection, token budget
│   ├── deep-research.js   # Decompose → investigate → synthesize
│   ├── scheduler.js       # 5-field cron parser
│   ├── cleanup.js         # Retention pruning (runs daily)
│   └── cookbook.js        # Per-harness model discovery
├── personalities/
│   ├── org-chart.json     # Source-of-truth org chart (CEO → directors → ICs)
│   └── agents/            # 16 personality charter files
└── tests/                 # node:test smoke tests
```

For deeper detail — schema version history, SSE event types, failover signal taxonomy, frontend tab map — read [HANDOFF.md](HANDOFF.md). For a front-desk map of the repo as an AI workbench — catalog, request slips, source material, durable state, review surfaces, and boundary layer — read [docs/WORKBENCH-CATALOG.md](docs/WORKBENCH-CATALOG.md).

## Roadmap

Near-term:

- Token and cost capture for all harnesses (currently real only for Claude)
- MCP server integration (`src/mcp.js` stub; needs `@modelcontextprotocol/sdk` go/no-go)
- Document ingestion — accept PDF/DOCX, convert to text for agent inputs
- Registry unification — collapse the flat `agentConfigs` and the `agents` table into one source of truth; make directors dispatchable via `/api/dispatch`
- Watchdog auto-nudge — currently logs stale agents but does not redispatch them

See `.planning/ROADMAP.md` for the longer arc.

## Contributing

PRs welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. The small-deps stance, vanilla-JS rule, and SQLite-only architecture are deliberate constraints, not negotiables. The test gate is `npm run verify` (syntax check + smoke suite + unit tests).

## License

MIT. See [LICENSE](LICENSE).
