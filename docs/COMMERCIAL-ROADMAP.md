# Commercial roadmap

This document lays out a pragmatic path from the current Visionary codebase to a
commercially viable product. The core stays MIT, local-first, and useful. Paid
offerings sit around installation, reliability, sync, support, and team-safe
operations.

## Target users

Visionary is strongest for users who already rely on multiple AI coding or
agent harnesses and want one local control plane with visible work artifacts.
### Solo operators

Solo operators are founders, consultants, researchers, and technical
generalists who want one machine to feel like a small AI organization. They
will pay for setup convenience and confidence that work stays under their
control.

- Signed desktop builds with auto-update.
- Guided setup for Claude Code, Codex, Gemini, Ollama, OpenClaw, Hermes, and
  Cursor.
- Local backup, restore, and optional encrypted sync across personal machines.
- Templates for research, bug fixing, release notes, and scheduled monitoring.

Likely price: $8 to $20 per month, or $99 to $149 per year.
### Indie developers

Indie developers want local orchestration for product work without moving repos,
prompts, or agent history into another hosted workspace. They care about repo
safety, reproducible runs, review loops, and cost visibility.

- Per-project harness profiles with explicit permissions.
- Task templates for implementation, tests, review, and release packaging.
- Token and cost accounting across every supported harness.
- Git-aware artifact summaries and pull request preparation.

Likely price: $15 to $35 per month, or $199 to $299 per year.
### Agencies

Agencies need repeatable workflows across client projects. They need separation
between clients, audit trails, support, and standard local agent policies.

- Client-specific policy packs for harnesses, tools, and writable folders.
- Encrypted backup or sync to customer-owned storage.
- Admin-visible run history, retention rules, and audit exports.
- Priority support and implementation help.

Likely price: $49 to $199 per seat per month, with support contracts above that.

## Licensing and monetization

The MIT core must include the local server, SQLite state, org chart, dispatch,
failover, artifacts, schedules, and PWA access. Commercial features must reduce
operational friction without weakening the local-first promise.

- Paid cloud sync: optional encrypted sync for metadata, settings, and artifact
  manifests, with artifacts opt-in only.
- Support: paid help for install, harness setup, debugging, policy design, and
  agency rollout.
- Hosted gateway: managed relay for remote access, webhook triggers,
  notifications, and team sharing.
- Pro features: signed app, auto-update, policy packs, templates, cost reports,
  retention rules, and audit export.
- Enterprise terms: support, indemnity, private integrations, and commercial
  terms for companies that need procurement coverage.

Recommendation: keep the core MIT and sell a Pro desktop subscription with
signed releases, auto-update, guided harness setup, policy packs, encrypted
backup or sync, and priority support. Add a hosted gateway later, after the
local first-run path is consistently successful.

## Top 10 product gaps

These are ranked by how much they block a new user from installing Visionary,
dispatching a first task, and seeing usable artifacts within 15 minutes.
### 1. First-run setup wizard

The app needs an in-product path that detects prerequisites and guides setup.

- A first-run screen appears when required settings or harnesses are missing.
- It checks Node, native SQLite binding health, artifact path access, and known
  harness binaries.
- Missing items include exact commands or links.
- A user can reach the dashboard without editing config files.
### 2. Harness connection tests

Users need to know which harnesses will actually run before dispatch.

- Settings shows each harness binary, version, auth status where available, and
  last health-check result.
- Each harness has a safe no-op test action.
- Failed tests show the attempted command and actionable fix.
- Dispatch defaults only to tested or explicitly enabled harnesses.
### 3. Safe sample project

The first run must prove dispatch, streaming, review, and artifacts without
touching a real repo.

- The app can create a sample project in a temporary working directory.
- The sample includes one prewritten task that creates a small artifact.
- The user can dispatch it with one primary action.
- Task detail shows live output, run status, workdir, and artifact list.
### 4. Permission model per harness

Commercial users need explicit permissions before agents touch files or shells.

- Each harness profile exposes allowed tools, writable roots, network access,
  and approval mode where supported.
- Dispatch shows the effective permission profile before start.
- Projects can override global defaults with stricter settings.
- Dangerous modes require one-time confirmation per project.
### 5. Artifact path clarity

Artifacts are central, so users need confidence about where output went.

- Task detail always shows absolute workdir and artifact root.
- Empty artifact lists explain whether no files changed or collection failed.
- File open failures show the reason, including containment rejection.
- Collection separates created, modified, and ignored files.
### 6. Install packaging

The install script is not enough for commercial adoption.

- GitHub Releases include signed macOS artifacts and checksums.
- Homebrew install and uninstall work on a clean macOS machine.
- `vision doctor` validates install health and prints fix commands.
- Install never overwrites an existing database without a backup.
### 7. Empty-state guidance

The UI must guide a new user to one successful run.

- Empty overview, board, agents, and artifacts states each offer one primary
  next action.
- The primary action is sample task creation or harness connection.
- Labels distinguish projects, tasks, runs, and artifacts consistently.
- The first successful artifact opens from task detail.
### 8. Cost and token reporting across harnesses

Claude cost capture exists, but users need a consistent cost picture.

- Every run records provider, model where known, tokens, estimated cost, and
  whether the value is real or estimated.
- The UI separates provider-reported usage from estimates.
- Project and agent views show totals over selectable time windows.
- Missing cost data is explicit.
### 9. Review loop calibration

Auto-review must be understandable and easy to override.

- Review prompts include artifact paths, task intent, and approval criteria.
- Verdicts show approve, reject, or needs human review with evidence.
- Retry limits are visible on the task.
- A user can manually approve, reject, or redispatch from review state.
### 10. Fifteen-minute operator guide

The README is strong for maintainers, but the product needs a short operator
guide tied to the packaged release.

- The guide covers install, doctor, harness test, sample task, artifact viewing,
  and shutdown.
- It avoids architecture until after the first run.
- Screenshots or a short GIF match the current native macOS UI.
- It states what stays local and what each harness may send to its provider.

## Four-week distribution sequence

Distribution must follow first-run reliability. Launching before the 15-minute
path works creates support load and weakens trust.
### Week 1: release hygiene

Ship the minimum release surface a technical stranger can verify.

- Cut a tagged release with checksums and a clear changelog.
- Add `vision doctor`.
- Record a clean install on a fresh macOS user account.
- Fix blockers to sample dispatch and artifact viewing.
### Week 2: packaging

Make installation standard enough that users don't need the repo.

- Create a Homebrew tap with install, upgrade, and uninstall.
- Publish signed macOS artifacts if signing is available.
- Write release notes around install, first run, and known limitations.
- Add a rollback path for database and app upgrades.
### Week 3: proof

Show the core loop in less than two minutes.

- Record a demo GIF: install, harness check, dispatch, streaming, artifact view,
  and open folder.
- Add a concise README entry that links to the quick start.
- Publish one real indie developer workflow.
- Ask external users to run the quick start from clean machines.
### Week 4: launch

Launch after at least three external users complete first dispatch without
private help.

- Post to Show HN with the local-first guarantee and current limitations.
- Share with indie developer and local-first communities.
- Track issues tagged `first-run`, `install`, `harness`, and `artifacts`.
- Triage first-run bugs before starting new feature work.
## Trust requirements

Trust is the product boundary. Visionary runs local orchestration over tools
that may touch source code, credentials, and client data.

**Security posture:**

- Bind to `127.0.0.1` by default; make remote access opt-in.
- Keep SQLite state local, inspectable, and exportable.
- Use `execFile`-style process execution and avoid shell interpolation.
- Keep containment checks for artifacts and reject symlink escapes.
- Publish a security policy, supported versions, and private report path.
- Test path traversal, artifact opening, permission profiles, and destructive
  dispatch options.

**Data-stays-local guarantee:**

- State that Visionary does not upload SQLite state, artifacts, prompts, or repo
  files to Visionary-operated servers by default.
- State that configured harnesses may send prompts, files, and outputs to their
  own providers.
- Require explicit opt-in for sync, hosted gateway, remote access, telemetry, or
  artifact backup.
- Provide local-only mode that disables Visionary-operated network features.

**Per-harness permission model:**

- Show effective permissions before each dispatch.
- Store permission profiles per project and harness.
- Prefer read-only defaults for chat, review, and research.
- Require confirmation for write, shell, network, broad filesystem, and
  skip-permission modes.
- Log permission profile, harness, command, working directory, and artifact root
  for every run.
