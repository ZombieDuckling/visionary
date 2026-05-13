# Technology Stack

**Project:** Visionary Mission Control
**Researched:** 2026-05-13
**Confidence:** HIGH

## Recommended Stack

### Core Runtime & Server

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Node.js | 22 LTS | Runtime, HTTP server, SSE, file I/O | Native `http` module replaces Express. Node 22 adds `crypto.randomUUID()`, `fs.glob()`, stable `node:test`, global `structuredClone()`, `URLSearchParams`. Zero-dep server is viable and maintainable. |
| `node:http` | stdlib | HTTP server, API routes, SSE streaming | `http.createServer` with manual routing via URL pathname matching. No Express needed for around 15 routes. |
| `node:child_process` | stdlib | OpenClaw CLI dispatch | `execFile('openclaw', [...args])` for agent dispatch. Use `spawn` for long-running tasks where you need streaming stdout for real-time progress. Always use `execFile` over `exec` to avoid shell injection. |
| `node:crypto` | stdlib | UUID generation | `crypto.randomUUID()` replaces the `uuid` npm package for task/agent IDs. |
| `node:fs` | stdlib | Workspace file reading | Read briefs, audits, memory chunks from `~/.openclaw/workspace`. Use `fs.readFileSync` for small files, `fs.createReadStream` for large ones. |
| `node:path` | stdlib | Path resolution | Safe cross-platform path joining for workspace files. |
| `node:url` | stdlib | URL parsing, query params | `new URL(req.url, base)` for route matching and query parameter extraction. |

### Database

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| better-sqlite3 | latest | SQLite binding | **The only npm dependency.** Synchronous API eliminates callback hell. 10x faster than node-sqlite3 for single-connection workloads. Native C++ addon, battle-tested. Prepared statements compile once, execute many times. `.transaction()` wrapper handles BEGIN/COMMIT/ROLLBACK automatically. |
| SQLite | 3.45+ (bundled) | Persistent storage | Single-file database. WAL mode enables concurrent readers without blocking writes. Perfect for single-user dashboard with one writer (server) and one reader (SSE polling). |

### Frontend (Embedded SPA)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Vanilla JS | ES2022+ | All client-side logic | No React, no Vue, no build step. Template literal HTML embedded in `server.js`. Modern browsers support everything needed: `fetch`, `EventSource`, Drag and Drop API, CSS Grid, Custom Properties, `structuredClone`. |
| HTML5 Drag and Drop API | native | Kanban board | `draggable="true"`, `dragstart`/`dragover`/`drop` events. No library needed for column-to-column task movement. |
| EventSource (SSE) | native | Real-time updates | Built-in browser API. Auto-reconnects with exponential backoff. Sends `Last-Event-ID` header on reconnect so server can replay missed events. |
| CSS Custom Properties | native | Theming, ops-center aesthetic | Define color palette as variables: `--bg-primary`, `--accent-green`, `--text-mono`. Monospace stack: `'JetBrains Mono', 'Fira Code', 'SF Mono', monospace`. |

### Real-Time Updates (SSE Architecture)

| Component | Implementation | Why |
|-----------|---------------|-----|
| Server endpoint | `GET /api/events` with `Content-Type: text/event-stream` | Native HTTP response streaming. No WebSocket library needed. SSE is HTTP-native, works through proxies, and auto-reconnects. |
| Event format | `id: {monotonic_id}\nevent: {type}\ndata: {json}\n\n` | Standard SSE format. Monotonic IDs enable replay on reconnect. Event types: `task_update`, `agent_status`, `notification`, `activity`. |
| Client | `new EventSource('/api/events')` | Zero-dependency. Browser handles reconnection, `Last-Event-ID` header. 3-second default retry, configurable via `retry:` field from server. |
| Event store | `events` table in SQLite | Append-only. Server queries `WHERE id > ?` using `Last-Event-ID` to replay missed events on reconnect. Prune events older than 24h via cron. |
| Keep-alive | `: keepalive\n\n` every 30s | SSE comment line prevents connection timeout. No data payload, just keeps the TCP connection alive. |

## SQLite Schema Strategy

### PRAGMA Configuration (run on every connection open)

```sql
PRAGMA journal_mode = WAL;          -- concurrent readers, no blocking
PRAGMA synchronous = NORMAL;        -- safe with WAL, 10x faster than FULL
PRAGMA foreign_keys = ON;           -- enforce referential integrity
PRAGMA busy_timeout = 5000;         -- wait 5s on lock contention instead of failing
PRAGMA cache_size = -20000;         -- ~20MB cache in memory
PRAGMA temp_store = MEMORY;         -- temp tables in RAM
PRAGMA wal_autocheckpoint = 1000;   -- checkpoint every 1000 pages (default)
```

**Confidence:** HIGH -- these PRAGMAs are universally recommended by better-sqlite3 maintainers, Simon Willison, and the SQLite documentation.

### better-sqlite3 Patterns

```javascript
// Connection setup (synchronous -- no await needed)
const Database = require('better-sqlite3');
const db = new Database('./visionary.db');
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('cache_size = -20000');
db.pragma('temp_store = MEMORY');

// Prepared statements -- compile once, reuse forever
const insertTask = db.prepare(`
  INSERT INTO tasks (id, title, description, status, agent_id, priority, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const getTasksByStatus = db.prepare(`
  SELECT * FROM tasks WHERE status = ? ORDER BY priority DESC, created_at ASC
`);

// Transactions -- atomic multi-row operations
const moveTask = db.transaction((taskId, newStatus) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
    .run(newStatus, Date.now(), taskId);
  db.prepare(`
    INSERT INTO task_events (task_id, event_type, old_value, new_value, created_at)
    VALUES (?, 'status_change', ?, ?, ?)
  `).run(taskId, task.status, newStatus, Date.now());
  db.prepare(`
    INSERT INTO events (event_type, payload, created_at)
    VALUES ('task_update', ?, ?)
  `).run(JSON.stringify({ taskId, status: newStatus }), Date.now());
});
```

### Core Tables

```sql
-- Tasks (Kanban cards)
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,              -- crypto.randomUUID()
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo',  -- todo|in_progress|review|done
  agent_id TEXT,                    -- assigned agent (jarvis, scout, etc.)
  priority INTEGER DEFAULT 0,      -- higher = more urgent
  project TEXT,                     -- project grouping
  created_at INTEGER NOT NULL,     -- epoch ms
  updated_at INTEGER,
  completed_at INTEGER
);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_agent ON tasks(agent_id);

-- Agent runs (dispatch tracking)
CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  agent_id TEXT NOT NULL,
  command TEXT NOT NULL,            -- the CLI command sent
  status TEXT DEFAULT 'running',   -- running|completed|failed
  output TEXT,                     -- JSON stdout from openclaw
  exit_code INTEGER,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX idx_runs_agent ON agent_runs(agent_id);
CREATE INDEX idx_runs_task ON agent_runs(task_id);

-- Notifications (inbox)
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,               -- pr_review|brief_ready|audit_alert|task_complete
  title TEXT NOT NULL,
  body TEXT,
  action_url TEXT,                  -- optional deep link
  source_agent TEXT,
  read INTEGER DEFAULT 0,
  dismissed INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_notif_unread ON notifications(read, dismissed);

-- Task events (audit trail)
CREATE TABLE task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT REFERENCES tasks(id),
  event_type TEXT NOT NULL,         -- status_change|assigned|comment|dispatched
  old_value TEXT,
  new_value TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_task_events_task ON task_events(task_id);

-- SSE events (real-time broadcast store)
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,  -- monotonic, used as SSE id:
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,                  -- JSON
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_events_id ON events(id);

-- Agent status cache
CREATE TABLE agent_status (
  agent_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  status TEXT DEFAULT 'idle',       -- idle|busy|error|offline
  current_task_id TEXT,
  last_heartbeat INTEGER,
  last_action TEXT,
  updated_at INTEGER
);
```

## Server Architecture Patterns

### Native HTTP Routing (No Express)

```javascript
const http = require('node:http');
const { URL } = require('node:url');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  // JSON response helper
  res.json = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  // Route matching
  if (method === 'GET' && path === '/') return serveHTML(res);
  if (method === 'GET' && path === '/api/events') return serveSSE(req, res);
  if (method === 'GET' && path === '/api/tasks') return getTasks(req, res);
  if (method === 'POST' && path === '/api/tasks') return createTask(req, res);
  if (method === 'PATCH' && path.startsWith('/api/tasks/')) return updateTask(req, res, path);
  if (method === 'POST' && path === '/api/dispatch') return dispatchAgent(req, res);
  // ... more routes

  res.writeHead(404);
  res.end('Not Found');
});
```

For around 15 routes, a flat `if/else` chain is clearer and faster than any router library. Extract path params with `path.split('/')[3]`.

### SSE Server Implementation

```javascript
const sseClients = new Set();

function serveSSE(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',     // disable nginx buffering if proxied
  });

  // Replay missed events on reconnect
  const lastId = parseInt(req.headers['last-event-id'] || '0', 10);
  if (lastId > 0) {
    const missed = db.prepare(
      'SELECT * FROM events WHERE id > ? ORDER BY id ASC'
    ).all(lastId);
    for (const evt of missed) {
      res.write(`id: ${evt.id}\nevent: ${evt.event_type}\ndata: ${evt.payload}\n\n`);
    }
  }

  // Keep-alive ping every 30s
  const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 30000);

  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
    clearInterval(keepAlive);
  });
}

// Broadcast to all connected clients
function broadcast(eventType, payload) {
  const evt = db.prepare(
    'INSERT INTO events (event_type, payload, created_at) VALUES (?, ?, ?)'
  ).run(eventType, JSON.stringify(payload), Date.now());

  const msg = `id: ${evt.lastInsertRowid}\nevent: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    client.write(msg);
  }
}
```

### OpenClaw CLI Dispatch Pattern

Use `execFile` (never `exec`) to prevent shell injection:

```javascript
const { execFile, spawn } = require('node:child_process');

function dispatchToAgent(agentId, message) {
  return new Promise((resolve, reject) => {
    execFile('openclaw', [
      'agent', '--agent', agentId,
      '--message', message,
      '--json'
    ], { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) return reject(error);
      try { resolve(JSON.parse(stdout)); }
      catch { resolve({ raw: stdout }); }
    });
  });
}

// For long-running tasks, use spawn for streaming output
function dispatchWithStreaming(agentId, message, onProgress) {
  const proc = spawn('openclaw', [
    'agent', '--agent', agentId,
    '--message', message, '--json'
  ]);
  let output = '';
  proc.stdout.on('data', (chunk) => {
    output += chunk;
    onProgress(chunk.toString());
  });
  return new Promise((resolve, reject) => {
    proc.on('close', (code) => {
      code === 0 ? resolve(output) : reject(new Error(`Exit code: ${code}`));
    });
  });
}
```

### Embedded SPA Pattern

The entire SPA lives inside a template literal served from memory. For maintainability as it grows, split into helper functions returning HTML strings:

```javascript
function serveHTML(res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Visionary Mission Control</title>
  <style>${renderCSS()}</style>
</head>
<body>
  ${renderApp()}
  <script>${renderScript()}</script>
</body>
</html>`);
}

// Split into composable sections
const renderCSS = () => `
  :root {
    --bg-primary: #0a0e14;
    --bg-secondary: #1a1e24;
    --bg-card: #12161c;
    --border: #2a2e34;
    --accent-green: #00ff88;
    --accent-blue: #00aaff;
    --accent-orange: #ff8800;
    --accent-red: #ff4444;
    --text-primary: #e0e0e0;
    --text-muted: #888;
    --font-mono: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', monospace;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: var(--font-mono);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 13px;
  }
`;

const renderApp = () => `<div id="app">...</div>`;
const renderScript = () => `
  const evtSource = new EventSource('/api/events');
  evtSource.addEventListener('task_update', (e) => {
    const data = JSON.parse(e.data);
    updateKanbanCard(data);
  });
`;
```

## Node.js stdlib Capabilities (No npm Needed)

| Need | stdlib Solution | Replaces |
|------|----------------|----------|
| UUID generation | `crypto.randomUUID()` | `uuid` package |
| HTTP server | `node:http` | `express` |
| URL parsing | `new URL()`, `URLSearchParams` | `url`, `qs` packages |
| JSON body parsing | `req.on('data')` + `JSON.parse()` | `body-parser` |
| Deep clone | `structuredClone()` | `lodash.cloneDeep` |
| File watching (dev) | `node --watch server.js` | `nodemon` |
| CLI execution | `child_process.execFile/spawn` | `execa` |
| Environment vars | `process.env` | `dotenv` (if .env not needed) |
| Path manipulation | `node:path` | -- |
| Timers | `setTimeout/setInterval` | -- |
| Event handling | `node:events` EventEmitter | -- |
| Testing | `node:test` + `node:assert` | `jest`, `mocha` |

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| HTTP server | `node:http` | Express | Adds 30+ transitive deps. For around 15 API routes, native is simpler and this project mandates zero deps. |
| Database | better-sqlite3 | Convex / Turso | Convex requires account + cloud. Turso adds network dependency. SQLite = single file, works offline, zero infrastructure. |
| Real-time | SSE via native HTTP | WebSocket (`ws`) | `ws` is an npm dep. SSE is HTTP-native, auto-reconnects, works through proxies, simpler server code. One-way server-to-client is sufficient for this dashboard. |
| Frontend | Vanilla JS | React/Vue/Svelte | Build step, npm deps, bundle size. Embedded template literal SPA has zero build tooling. For a single-user ops dashboard, vanilla is fast enough. |
| Templating | Template literals | EJS/Handlebars | Additional dep. JS template literals do the same thing natively. |
| Drag and Drop | HTML5 DnD API | SortableJS | Another dep. Native DnD API handles kanban column moves. Touch support can be added with pointer events if needed later. |
| Routing | if/else chain | URLPattern API | URLPattern is still experimental in Node 22. Simple pathname matching is sufficient for around 15 routes. |

## Installation

```bash
# The entire dependency tree
npm install better-sqlite3

# That is it. One dependency.
```

## Development Tooling (optional, zero-dep)

```bash
# File watching for dev (Node 22 native)
node --watch server.js

# Testing (Node 22 native)
node --test test/

# No build step, no bundler, no transpiler
```

## Performance Considerations

| Concern | Approach |
|---------|----------|
| SQLite write contention | WAL mode + `busy_timeout = 5000`. Single writer is fine for single-user app. |
| SSE memory per client | Each client holds one `res` object in `sseClients` Set. Josh is the only user, so 1-3 connections max. |
| Large SPA HTML | Template literal is served from memory (no disk read). Gzip not needed for single user on localhost. |
| OpenClaw CLI latency | `execFile` is non-blocking (spawns child process). Use `spawn` for streaming long tasks. |
| Event table growth | Prune events older than 24h daily. `DELETE FROM events WHERE created_at < ?` in a scheduled interval. |

## Sources

- [MDN: Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) -- HIGH confidence, authoritative spec documentation
- [MDN: Using Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) -- HIGH confidence
- [better-sqlite3 API docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) -- HIGH confidence, official repository
- [better-sqlite3 WAL Mode and Performance Tuning](https://deepwiki.com/WiseLibs/better-sqlite3/3.4-wal-mode-and-performance-tuning) -- HIGH confidence
- [SQLite Performance Tuning (phiresky)](https://phiresky.github.io/blog/2020/sqlite-performance-tuning/) -- HIGH confidence, widely cited reference
- [Understanding SQLite PRAGMA with better-sqlite3](https://dev.to/lovestaco/understanding-sqlite-pragma-and-how-better-sqlite3-makes-it-nicer-1ap0) -- MEDIUM confidence
- [Simon Willison: JSON Audit Log in SQLite](https://til.simonwillison.net/sqlite/json-audit-log) -- HIGH confidence
- [Node.js Features Replacing npm Packages](https://nodesource.com/blog/nodejs-features-replacing-npm-packages) -- MEDIUM confidence
- [HTML Living Standard: SSE Spec](https://html.spec.whatwg.org/multipage/server-sent-events.html) -- HIGH confidence, authoritative
- [Vanilla JS Kanban with Drag and Drop](https://dev.to/keval_sindhu_6d63886782e1/i-built-a-full-kanban-board-in-vanilla-javascript-with-drag-drop-time-tracking-55a7) -- MEDIUM confidence
- [Node.js Child Process Documentation](https://nodejs.org/api/child_process.html) -- HIGH confidence, official docs
- [SQLite as Best DB for AI Agents](https://dev.to/nathanhamlett/sqlite-is-the-best-database-for-ai-agents-and-youre-overcomplicating-it-1a5g) -- MEDIUM confidence
- [Hermes Agent Kanban Schema](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban) -- MEDIUM confidence, real-world reference
- [SSE Tutorial (javascript.info)](https://javascript.info/server-sent-events) -- MEDIUM confidence
