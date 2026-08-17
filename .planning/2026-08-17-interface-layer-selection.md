# GSD Quick: Interface Layer Selection

## Intent
Capture the Jake Van Clief lesson that chat, desktop/file agents, IDE agents, terminal agents, scripts, and custom orchestration are different interface layers. Visionary should expose this as product judgment so future work does not overbuild agent orchestration where a smaller deterministic surface is better.

## Scope
- Add a small operator/product decision guide under `docs/`.
- Link it from the workbench catalog.
- Do not touch existing uncommitted chat UI/session changes.

## Verification
- Documentation links resolve via `npm run workspace-map`.
- Markdown/file hygiene via `git diff --check`.
