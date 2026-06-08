# Contributing to Visionary

Thanks for considering a contribution. Visionary is small on purpose — read this before opening a PR so we're aligned on the constraints.

## The deliberate constraints

These aren't preferences, they're load-bearing decisions:

1. **One npm dependency.** `better-sqlite3`. Everything else uses Node.js 22 stdlib (`node:http`, `node:crypto`, `node:test`, etc.). PRs that add deps need to justify why stdlib won't do.
2. **No build step on the frontend.** Vanilla JS, vanilla CSS, plain HTML. No React, no Vue, no bundler. If you want a framework, this isn't the project.
3. **SQLite is the database.** Not Postgres, not Convex, not "pluggable". Single file, single user, WAL mode.
4. **Server-Sent Events, not WebSocket.** SSE is HTTP-native, auto-reconnects, works through proxies. One-way push is enough for a dashboard.
5. **Local-first.** No cloud, no telemetry, no analytics. The SQLite file never leaves the user's disk unless they put it there.

If your PR fights any of these, open an issue first to discuss.

## Development

```bash
git clone https://github.com/ZombieDuckling/visionary.git
cd visionary
npm install
npm run verify        # check syntax + smoke tests
npm start             # run the server (http://127.0.0.1:3333)
npm run app           # run the Electron shell
```

## Tests

```bash
npm run check         # syntax check on all JS files
npm run smoke         # node:test smoke suite
npm run verify        # both of the above
```

All PRs must pass `npm run verify` locally before being submitted.

## Pull request checklist

- [ ] `npm run verify` passes
- [ ] No new npm dependencies (or a clear justification in the PR body)
- [ ] No hardcoded absolute paths (`/Users/...`, `/home/...`) — use env vars or relative paths
- [ ] No personal info (emails, names, phone numbers) in committed files
- [ ] Updated `README.md` if user-facing behavior changed
- [ ] Added a `tests/smoke.mjs` case for new endpoints or DB operations

## Reporting issues

Use the issue templates. For bugs include: OS, Node version, what you ran, what happened, what you expected.

## Code of conduct

Be decent. No tolerance for harassment.

## License

By contributing, you agree your contributions are licensed under the MIT License (see [LICENSE](LICENSE)).
