# Security Policy

## Supported versions

Visionary is in early public release. Only the latest tagged version on `main` receives security fixes.

| Version | Supported |
|---------|-----------|
| latest `main` | yes |
| anything older | no |

## Reporting a vulnerability

If you find a security issue, **do not open a public GitHub issue.** Instead:

1. Use GitHub's [private vulnerability reporting](https://github.com/ZombieDuckling/visionary/security/advisories/new) so the report stays confidential while we triage.
2. Include: a description, reproduction steps, the affected commit hash, and (if you have one) a proposed fix or mitigation.

You can expect an initial acknowledgement within 7 days. We aim to ship a fix within 30 days for high-severity issues.

## Threat model assumptions

Visionary is a **local-first single-user app** by design. The following are explicitly OUT of scope:

- Multi-tenant isolation (there is no multi-tenancy)
- Network-level threats against `127.0.0.1:3333` (the server is not intended to bind to public interfaces)
- Browser sandbox escapes via the Electron shell (these are upstream Electron issues)
- Attacks via the user's own SQLite file (the user controls their disk)

The following ARE in scope:

- Command injection via dispatch endpoints (we use `execFile`, not `exec`; report anything that gets us back to shell)
- SQL injection (we use prepared statements; report any inline SQL that could be parameterized but isn't)
- Path traversal in workspace file reads (the `WORKSPACE` path is meant to constrain reads to `$HOME/.openclaw/workspace`)
- Prototype pollution via JSON body parsing
- Supply-chain risks via the single npm dependency (`better-sqlite3`)

## Security-relevant configuration

- Always bind to `127.0.0.1`, never `0.0.0.0`, unless you've placed an authenticating reverse proxy in front.
- Don't share your `visionary.sqlite` file — it contains your full agent history.
- Keep `VISIONARY_WORKSPACE` pointing at a path you trust.
