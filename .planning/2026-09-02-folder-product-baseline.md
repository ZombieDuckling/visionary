# GSD Quick — Folder-product baseline prompt nudge

## Context
Jake Van Clief short `cAADijrIs9Y` reinforces that many "agent software" ideas are just folders, routing markdown, context files, and tools with a wrapper. Visionary should keep its product value anchored in the deployment/governance layer a folder lacks: roles, permissions, privacy, collaboration, artifact visibility, and continuity.

## Target
Add one deterministic dispatch nudge that fires on product/app/dashboard/agent build requests and forces a quick baseline check: can a folder/workbench plus model solve this before building heavier software? If not, name the deployment/governance value Visionary should capture.

## Scope
- Add small `src/folder-product-baseline.js` classifier/prompt module.
- Wire it into `server.js` prompt augmentation.
- Add unit tests.
- Update README feature notes.

## Verification
- `npm run check`
- focused unit test
- `npm run verify` if safe within time
- `git diff --check`
