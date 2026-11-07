# Capability-Assumption Review Guide

A claim that the AI or a tool *cannot* do something is a **dated tactic**, not a permanent fact. Capability ratchets: a limitation that was real when it was formed — the way "language models are useless" was defensible at a GPT-3 level — can be false on the current model or provider. Freezing such a claim into memory, a workflow shape, or a routing decision makes Visionary keep building around a limitation that a newer model already cleared.

Use this guide when a request, brief, or routing decision leans on a "the model can't…" / "AI isn't reliable enough…" claim.

## Review steps

1. **Name the assumption.** Which model/provider/tool, which capability, and — if knowable — the capability level at which the claim was defensible.
2. **Assume it may have expired.** Treat the claim as time-stamped; capability change is the default expectation, not a surprise.
3. **Separate the durable goal from the dated tactic.** The workflow outcome and the decision a person owns are durable; the "can't" claim is only the tactic layered on top.
4. **Attach a re-test trigger.** A model release, a provider change, or a prompt/context change is the signal to re-open the claim.
5. **Re-test cheaply.** Probe the current model directly on the claimed capability (a small representative task), or run a shadow task on the newer model, before deciding to keep working around the limitation.
6. **Record the dated claim.** Where the assumption lives (a dated note, a ledger row) so a future run can find and re-open it.
7. **Verdict.** Capability-assumption-held (the goal genuinely needs the workaround) versus stale/re-test (re-run the probe on the current model first).

## Why this is a reliability control, not pessimism

Visionary routes work across harnesses and models. A stale capability assumption silently mis-routes: it keeps a task on a weaker fallback, blocks an autonomous step that is now safe, or forces manual handoffs that the current model no longer needs. Re-testing the assumption on capability change is how the routing plan stays honest as the floor rises.

## Anti-patterns

- Freezing "the model can't do X" into memory or a skill as settled.
- Redesigning a workflow around a limitation with no re-test trigger.
- Treating a dated capability claim as a durable principle.
- Keeping a manual workaround long after the model cleared the limitation it was written for.

## Relationship to other controls

- **spec-before-the-machine** — write the capability spec despite the tooling gap; this control instead re-tests the gap claim itself.
- **workflow-resilience** — provider outage/quota/degradation; this control is about the steady-state capability ceiling.
- **runtime-reach-portability** — whether a runtime has the reach a job needs; this control is about whether a capability claim is still true.
- **baseline-ratchet** — raising the challenge as the floor rises; this control is the mechanism that catches the floor having risen.
