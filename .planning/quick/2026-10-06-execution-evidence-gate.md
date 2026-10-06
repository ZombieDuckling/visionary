# Execution-evidence dispatch nudge

## Context
Latest Jake Van Clief ingestion emphasized that a green/running status only proves a workflow did not crash. Reliable automation needs per-step artifacts, cheap checks, and human gates before downstream or external use.

## Small improvement
Add a deterministic prompt nudge for AI automation/status/reporting requests that might otherwise trust "running", "green", or "completed" state without checking produced evidence.

## Acceptance checks
- Classifier ignores ordinary status updates with no automation/evidence risk.
- Classifier detects AI automation/report workflows that mention running/green/success/completed plus report/artifact/check signals.
- Prompt block names expected artifact, cheap one-minute checks, status-vs-correctness distinction, human gate, and safe stop behavior.
- Wire the nudge into server dispatch augmentation.
- Run targeted tests plus project verification.
