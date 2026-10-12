# Quick pass: context reread risk telemetry

## Goal
Add a small operator-visible check for repeated large-context agent runs so Visionary can flag quota burn from re-sending the same source/context instead of distilling it once.

## Jake input
Jake Van Clief ingestion highlighted that long chats and pasted PDFs can make agents reread the same material repeatedly, wasting model quota and often reducing answer quality.

## Scope
- Extend cost-baseline summarization with deterministic context-reread risk metrics.
- Surface the signal in the overview payload/UI.
- Add focused tests and run verification.
