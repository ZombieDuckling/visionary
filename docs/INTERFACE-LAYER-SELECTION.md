# Interface Layer Selection Guide

Visionary should not assume every workflow deserves a custom multi-agent runtime. The operator experience gets better when the interface layer matches the job: sometimes the right answer is a simple script, a chat answer, a file-capable co-work session, or an IDE/terminal agent rather than more dashboard machinery.

Use this guide before promoting a workflow into a first-class Visionary feature.

## Decision table

| Layer | Best for | Visionary implication | Avoid when |
|---|---|---|---|
| Plain chat | One-off reasoning, critique, naming, small planning | Keep as Argus conversation; summarize only durable outcomes | The work must edit files, run commands, or leave audit evidence |
| File/co-work agent | Bounded document sets, briefs, folder-based synthesis | Attach source folders/artifacts and capture the resulting brief | The task needs repo-local commands, tests, or live process control |
| IDE agent | Code edits where local project context and developer review matter | Open the repo/workdir and require diff/test evidence before status changes | The work is mostly deterministic or should run unattended |
| Terminal agent | Build/test/debug loops, migrations, operational scripts | Store command output, changed files, and verification in the run record | The task handles secrets or risky side effects without guardrails |
| Deterministic script/route | Repeatable transforms, validation, cleanup, exports, health checks | Prefer `scripts/` or API routes with tests before adding LLM autonomy | The workflow requires judgment over messy new context |
| Custom orchestration | Multi-step work requiring role routing, state, retries, review, or scheduled operation | Make it a Visionary product surface with explicit artifacts, cost, and review states | The value is not recurring or the operator cannot inspect results |

## Promotion ladder

1. **Chat answer** — useful once, no durable state needed.
2. **Saved note or artifact** — useful again, but still human-run.
3. **Script/route** — repeatable enough to verify deterministically.
4. **Agent dispatch** — requires judgment, tools, or synthesis.
5. **Scheduled/long-running automation** — recurring and safe with review surfaces.
6. **First-class product integration** — common enough that the UI should guide non-experts through it.

Do not skip the lower layers just because an agent can do the work. The lower layer is often cheaper, safer, faster, and easier to debug.

## Required review questions

Before implementing a new Visionary workflow, answer these in the plan or PR notes:

- What must the model see: chat context, files, repo, shell, database rows, or external systems?
- What must the workflow change: nothing, docs, code, SQLite state, artifacts, schedules, or external accounts?
- Where will evidence land so Josh can verify it later?
- Can the work be a deterministic script or route first?
- What is the cost/risk envelope, and where should the operator approve or stop it?
- Which existing personality/role owns the work, if any?

## Product direction

Visionary should become a layer selector, not only an agent launcher. The dashboard should help the operator choose the smallest effective surface, then preserve context, artifacts, verification, and handoff state when escalation is justified.
