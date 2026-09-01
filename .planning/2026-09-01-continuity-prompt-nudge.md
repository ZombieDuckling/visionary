# 2026-09-01 Continuity prompt nudge

## Goal
Add one small Visionary improvement that helps agent dispatches resume work with source-linked continuity instead of treating every request as a blank chat.

## Jake lesson applied
Jake ingestion emphasizes folder/workbench continuity, position-addressed memory, and durable handoffs. Visionary already stores workdirs/artifacts; the missing small surface is a deterministic nudge when the operator asks an agent to continue, resume, pick up, unblock, or produce a handoff.

## Scope
- Add a deterministic continuity-workbench prompt helper.
- Wire it into `buildAgentPrompt` before existing artifact/challenge/governance-style prompt nudges.
- Add focused unit tests.
- Document the maintenance heuristic.

## Verification
Run targeted unit test, syntax check, workspace map, and full verify if practical.
