# Architecture Patterns

**Domain:** Web-based agent orchestration dashboard (single-user ops center)
**Researched:** 2026-05-13
**Overall Confidence:** HIGH

## Recommended Architecture

Single-process Node.js server with embedded SPA, SQLite persistence, SSE real-time push, and child_process-based agent dispatch.

```
+------------------------------------------------------------------+
|                        Browser (SPA)                              |
|                                                                   |
|  +----------+ +---------+ +--------+ +-------+ +---------------+ |
|  | TaskBoard| | AgentDsk| | Inbox  | | CmdBar| | ActivityFeed  | |
|  +----+-----+ +----+----+ +---+----+ +---+---+ +-------+-------+ |
|       |            |          |           |             |         |
|  +----+------------+----------+-----------+-------------+------+ |
|  |                     State Store (Proxy)                     | |
|  +-----+-------------------+----------------------------------+ |
|        |                   |                                     |
|   [EventSource/SSE]   [fetch /api/*]                             |
+--------+-------------------+-------------------------------------+
         |                   |
+--------+-------------------+-------------------------------------+
|                      server.js (Node.js)                         |
|                                                                   |
|  +-------------+  +-------------+  +---------------------------+ |
|  | HTTP Router |  | SSE Broker  |  | Static / SPA Serve        | |
|  +------+------+  +------+------+  +---------------------------+ |
|         |                |                                        |
|  +------+------+  +------+------+  +---------------------------+ |
|  | REST API    |  | Event Bus   |  | Agent Dispatcher          | |
|  | Controllers |  | (EventEmit) |  | (child_process.execFile)  | |
|  +------+------+  +------+------+  +-------------+-------------+ |
|         |                |                        |               |
|  +------+----------------+------------------------+-------------+ |
|  |                    Database Layer (better-sqlite3)            | |
|  |  tasks | agent_runs | notifications | projects | activity_log| |
|  +--------------------------------------------------------------+ |
|         |                                                         |
|  +------+------+                                                  |
|  |  visionary  |                                                  |
|  |  .sqlite    |                                                  |
|  +-------------+                                                  |
+-------------------------------------------------------------------+
         |
         | child_process.execFile
         v
+-------------------+
| openclaw agent    |
| --agent <id>      |
| --message "..."   |
| --json            |
+-------------------+
         |
         v
+-------------------+
| OpenClaw Gateway  |
| port 18789        |
+-------------------+
```

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| **HTTP Router** | Parse URL + method, dispatch to controller or static serve | REST Controllers, SPA Serve |
| **REST Controllers** | CRUD for tasks, projects, notifications; trigger dispatches | Database Layer, Agent Dispatcher, Event Bus |
| **SSE Broker** | Manage client connections, push events on bus emission | Event Bus, Browser EventSource |
| **Event Bus** | In-process EventEmitter linking all server components | REST Controllers, Agent Dispatcher, SSE Broker |
| **Agent Dispatcher** | Spawn `openclaw agent` as child process, capture JSON result | OpenClaw CLI, Database Layer, Event Bus |
| **Database Layer** | Prepared statements, transactions, migrations | SQLite file |
| **State Store** | Client-side Proxy-based reactive state | All UI Components |
| **UI Components** | Render functions returning HTML strings, bind to DOM | State Store, fetch API, EventSource |

---

## 1. Server Architecture

### Single server.js with Internal Modules

Use a single `server.js` entry point but organize internally with clear module boundaries. The file serves three roles: HTTP server, REST API, and SSE broker.

```
server.js          -- entry point, HTTP server, router
  db.js            -- database init, migrations, prepared statements
  api.js           -- route handlers / controllers
  dispatcher.js    -- agent dispatch via child_process
  sse.js           -- SSE connection manager + event broadcast
  public/
    index.html     -- SPA shell (served as static file)
    css/           -- dark ops-center theme styles
    js/            -- client-side modules
```

**Rationale:** While PROJECT.md says "single server.js", splitting into a handful of modules with `require()` keeps each under 300 lines without adding build complexity. No bundler needed -- just `node server.js`.

### HTTP Router Pattern (No Express)

Use Node's native `http.createServer` with a lightweight regex-based router:

```javascript
const http = require('http');
const { parse } = require('url');

// Route table: [method, pathRegex, handler]
const routes = [
  ['GET',    /^\/api\/tasks$/,              handlers.listTasks],
  ['POST',   /^\/api\/tasks$/,              handlers.createTask],
  ['PATCH',  /^\/api\/tasks\/(\d+)$/,       handlers.updateTask],
  ['DELETE', /^\/api\/tasks\/(\d+)$/,       handlers.deleteTask],
  ['POST',   /^\/api\/tasks\/(\d+)\/dispatch$/, handlers.dispatchTask],
  ['GET',    /^\/api\/agents$/,             handlers.listAgents],
  ['GET',    /^\/api\/agents\/(\w+)\/status$/, handlers.agentStatus],
  ['GET',    /^\/api\/notifications$/,      handlers.listNotifications],
  ['PATCH',  /^\/api\/notifications\/(\d+)$/, handlers.updateNotification],
  ['GET',    /^\/api\/activity$/,           handlers.getActivity],
  ['GET',    /^\/api\/projects$/,           handlers.listProjects],
  ['GET',    /^\/api\/crons$/,              handlers.listCrons],
  ['POST',   /^\/api\/dispatch$/,           handlers.quickDispatch],
  ['GET',    /^\/api\/events$/,             handlers.sseConnect],
];

const server = http.createServer((req, res) => {
  const { pathname } = parse(req.url, true);
  const match = routes.find(([method, pattern]) =>
    req.method === method && pattern.test(pathname)
  );
  if (match) {
    const params = pathname.match(match[1]).slice(1);
    match[2](req, res, params);
  } else {
    serveStatic(req, res, pathname);  // SPA fallback
  }
});
```

**Key design decisions:**
- Regex-based routes with capture groups for IDs
- All API routes under `/api/` prefix
- Non-API routes serve static files or fall back to `index.html` (SPA)
- JSON body parsing via a small helper (`readBody(req)` that collects chunks)

### SSE Implementation

SSE is the right choice over WebSockets here. One-way server-to-client push is all we need -- the client uses `fetch()` for commands. SSE auto-reconnects, works through proxies, and needs zero npm dependencies.

```javascript
// sse.js
const EventEmitter = require('events');
const bus = new EventEmitter();
const clients = new Set();

function sseConnect(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',  // nginx compat
  });
  res.write(':ok\n\n');  // initial comment to flush

  const client = { res, id: Date.now() };
  clients.add(client);
  req.on('close', () => clients.delete(client));
}

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    client.res.write(msg);
  }
}

// Wire: any bus event broadcasts to all SSE clients
bus.on('task:created',    (d) => broadcast('task:created', d));
bus.on('task:updated',    (d) => broadcast('task:updated', d));
bus.on('agent:started',   (d) => broadcast('agent:started', d));
bus.on('agent:completed', (d) => broadcast('agent:completed', d));
bus.on('agent:failed',    (d) => broadcast('agent:failed', d));
bus.on('notification:new',(d) => broadcast('notification:new', d));
bus.on('activity:new',    (d) => broadcast('activity:new', d));
```

**SSE event types:**

| Event | Payload | Trigger |
|-------|---------|---------|
| `task:created` | Full task object | POST /api/tasks |
| `task:updated` | Task with changed fields | PATCH /api/tasks/:id |
| `task:moved` | { id, from_status, to_status } | Kanban drag-drop |
| `agent:started` | { run_id, agent_id, task_id } | Dispatch initiated |
| `agent:progress` | { run_id, status, elapsed_ms } | Heartbeat during run |
| `agent:completed` | { run_id, result, duration_ms } | CLI returns success |
| `agent:failed` | { run_id, error, duration_ms } | CLI returns error |
| `notification:new` | Full notification object | Agent produces actionable output |
| `activity:new` | Activity log entry | Any system event |

### Heartbeat and Reconnection

```javascript
// Send keepalive every 30s to prevent connection drops
setInterval(() => {
  for (const client of clients) {
    client.res.write(':heartbeat\n\n');
  }
}, 30000);
```

The browser `EventSource` auto-reconnects. Send `id:` fields so the client can use `Last-Event-ID` header on reconnect to catch up on missed events.

---

## 2. Database Schema

### SQLite Configuration (Critical)

```javascript
const Database = require('better-sqlite3');
const db = new Database('./visionary.sqlite');

// Performance pragmas -- set once at startup
db.pragma('journal_mode = WAL');          // concurrent reads during writes
db.pragma('synchronous = NORMAL');        // safe + fast (not FULL)
db.pragma('cache_size = -64000');         // 64MB cache
db.pragma('temp_store = MEMORY');         // temp tables in RAM
db.pragma('mmap_size = 268435456');       // 256MB memory-mapped I/O
db.pragma('foreign_keys = ON');           // enforce FK constraints
```

### Schema

```sql
-- Projects: top-level grouping
CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  description TEXT,
  color       TEXT DEFAULT '#00ff41',     -- for UI accent
  status      TEXT DEFAULT 'active'
                CHECK(status IN ('active','paused','archived')),
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- Tasks: the core work unit
CREATE TABLE IF NOT EXISTS tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER REFERENCES projects(id),
  title        TEXT NOT NULL,
  description  TEXT,
  status       TEXT DEFAULT 'todo'
                 CHECK(status IN ('todo','in_progress','review','done')),
  priority     TEXT DEFAULT 'medium'
                 CHECK(priority IN ('critical','high','medium','low')),
  agent_id     TEXT,                      -- assigned agent (e.g., 'forge')
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  sort_order   INTEGER DEFAULT 0          -- for drag-drop ordering
);

-- Agent runs: each dispatch of an agent
CREATE TABLE IF NOT EXISTS agent_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id      INTEGER REFERENCES tasks(id),
  agent_id     TEXT NOT NULL,             -- e.g., 'forge', 'scout'
  session_id   TEXT,                      -- OpenClaw session ID
  message      TEXT NOT NULL,             -- the prompt sent
  status       TEXT DEFAULT 'pending'
                 CHECK(status IN ('pending','running','completed',
                                   'failed','timeout')),
  result_json  TEXT,                      -- full JSON response from CLI
  result_text  TEXT,                      -- extracted text payload
  error        TEXT,                      -- error message if failed
  delivery_status TEXT,                   -- sent/suppressed/failed
  duration_ms  INTEGER,
  started_at   TEXT,
  completed_at TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);

-- Notifications: actionable items from agent output
CREATE TABLE IF NOT EXISTS notifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_run_id INTEGER REFERENCES agent_runs(id),
  type         TEXT NOT NULL
                 CHECK(type IN ('info','action','warning','error')),
  title        TEXT NOT NULL,
  body         TEXT,
  action_type  TEXT,                      -- 'approve_pr','review_brief',
                                          -- 'acknowledge','dismiss'
  action_data  TEXT,                      -- JSON with action params
  read         INTEGER DEFAULT 0,
  dismissed    INTEGER DEFAULT 0,
  created_at   TEXT DEFAULT (datetime('now'))
);

-- Activity log: append-only event stream
CREATE TABLE IF NOT EXISTS activity_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type  TEXT NOT NULL,              -- 'task.created','agent.completed'
  agent_id    TEXT,
  task_id     INTEGER,
  project_id  INTEGER,
  summary     TEXT NOT NULL,              -- human-readable one-liner
  detail_json TEXT,                       -- full event data
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_task ON agent_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read, dismissed);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_agent ON activity_log(agent_id);
```

### Entity Relationship

```
projects 1---* tasks 1---* agent_runs 1---* notifications
                |                |
                +-------+--------+
                        |
                   activity_log
                  (references both
                   via task_id,
                   agent_id)
```

### Prepared Statement Pattern

Use better-sqlite3's synchronous prepared statements for all queries. Wrap multi-step operations in transactions.

```javascript
// db.js -- export prepared statements
const stmts = {
  insertTask: db.prepare(`
    INSERT INTO tasks (project_id, title, description, status, priority, agent_id, sort_order)
    VALUES (@project_id, @title, @description, @status, @priority, @agent_id, @sort_order)
  `),
  getTasksByStatus: db.prepare(`
    SELECT t.*, p.name as project_name, p.color as project_color
    FROM tasks t LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.status = ? ORDER BY t.sort_order, t.created_at DESC
  `),
  moveTask: db.prepare(`
    UPDATE tasks SET status = @status, sort_order = @sort_order,
    updated_at = datetime('now'),
    completed_at = CASE WHEN @status = 'done' THEN datetime('now') ELSE completed_at END
    WHERE id = @id
  `),
  insertRun: db.prepare(`
    INSERT INTO agent_runs (task_id, agent_id, session_id, message, status, started_at)
    VALUES (@task_id, @agent_id, @session_id, @message, 'running', datetime('now'))
  `),
  completeRun: db.prepare(`
    UPDATE agent_runs SET status = @status, result_json = @result_json,
    result_text = @result_text, error = @error,
    delivery_status = @delivery_status, duration_ms = @duration_ms,
    completed_at = datetime('now')
    WHERE id = @id
  `),
};

// Transaction example: dispatch creates run + updates task + logs activity
const dispatchTransaction = db.transaction((taskId, agentId, message) => {
  stmts.moveTask.run({ id: taskId, status: 'in_progress', sort_order: 0 });
  const run = stmts.insertRun.run({
    task_id: taskId, agent_id: agentId,
    session_id: null, message
  });
  stmts.insertActivity.run({
    event_type: 'agent.dispatched', agent_id: agentId,
    task_id: taskId, summary: `Dispatched ${agentId} for task #${taskId}`
  });
  return run.lastInsertRowid;
});
```

---

## 3. Frontend Architecture

### Vanilla JS SPA Pattern

No React, no Vue, no build step. The SPA uses three core patterns:

1. **Proxy-based reactive state** -- state changes trigger re-renders
2. **Component functions** -- pure functions that return HTML strings
3. **Hash-based routing** -- `#/board`, `#/agents`, `#/inbox`, etc.

### State Store

```javascript
// state.js -- reactive state with Proxy
const state = new Proxy({
  tasks: { todo: [], in_progress: [], review: [], done: [] },
  agents: [],
  notifications: [],
  activity: [],
  activeTab: 'board',
  commandBarOpen: false,
}, {
  set(target, prop, value) {
    target[prop] = value;
    renderIfNeeded(prop);  // selective re-render
    return true;
  }
});
```

**Why Proxy over manual pub/sub:** Proxy intercepts all writes without requiring explicit `setState()` calls. Keeps the code simple for a single-developer project. No need for Redux-style ceremony.

### Component Pattern

Each UI section is a render function. Components return HTML strings and get injected into their container element.

```javascript
// components/task-card.js
function TaskCard(task) {
  const agentBadge = task.agent_id
    ? `<span class="badge agent-${task.agent_id}">${task.agent_id}</span>`
    : '';
  const priorityClass = `priority-${task.priority}`;
  return `
    <div class="task-card ${priorityClass}"
         draggable="true"
         data-task-id="${task.id}"
         data-status="${task.status}">
      <div class="task-header">
        <span class="task-title">${esc(task.title)}</span>
        ${agentBadge}
      </div>
      <div class="task-meta">
        ${task.project_name
          ? `<span class="project-tag" style="border-color:${task.project_color}">${esc(task.project_name)}</span>`
          : ''}
      </div>
      <div class="task-actions">
        <button data-action="dispatch" data-task-id="${task.id}" title="Dispatch">&#9654;</button>
      </div>
    </div>
  `;
}

// Render a full column
function KanbanColumn(status, tasks) {
  return `
    <div class="kanban-column" data-status="${status}"
         ondragover="event.preventDefault()"
         ondrop="handleDrop(event, '${status}')">
      <h3>${statusLabels[status]} <span class="count">${tasks.length}</span></h3>
      <div class="card-list">
        ${tasks.map(TaskCard).join('')}
      </div>
    </div>
  `;
}
```

### Rendering Strategy: Targeted DOM Updates

Full `innerHTML` replacement is fine for small lists but causes flicker on large boards. Use a hybrid approach:

```javascript
// Selective re-render: only update the column that changed
function renderBoard() {
  for (const status of ['todo', 'in_progress', 'review', 'done']) {
    const col = document.querySelector(
      `[data-status="${status}"] .card-list`
    );
    if (col) col.innerHTML = state.tasks[status].map(TaskCard).join('');
  }
}

// For activity feed: prepend new items instead of re-rendering all
function prependActivity(entry) {
  const feed = document.getElementById('activity-feed');
  feed.insertAdjacentHTML('afterbegin', ActivityEntry(entry));
  // Trim old entries to prevent DOM bloat
  while (feed.children.length > 100) feed.lastChild.remove();
}
```

### Tab Routing

Hash-based routing is simplest for an embedded SPA. No server config needed.

```javascript
const tabs = {
  '#/board':     { render: renderBoardView,    label: 'Board' },
  '#/agents':    { render: renderAgentsView,    label: 'Agents' },
  '#/inbox':     { render: renderInboxView,     label: 'Inbox' },
  '#/activity':  { render: renderActivityView,  label: 'Activity' },
  '#/crons':     { render: renderCronsView,     label: 'Crons' },
  '#/briefs':    { render: renderBriefsView,    label: 'Briefs' },
  '#/security':  { render: renderSecurityView,  label: 'Security' },
  '#/memory':    { render: renderMemoryView,    label: 'Memory' },
};

function navigate() {
  const hash = location.hash || '#/board';
  const tab = tabs[hash];
  if (!tab) { location.hash = '#/board'; return; }

  state.activeTab = hash;
  document.getElementById('main-content').innerHTML = '';
  tab.render(document.getElementById('main-content'));

  // Update nav highlights
  document.querySelectorAll('.nav-tab').forEach(el => {
    el.classList.toggle('active', el.getAttribute('href') === hash);
  });
}

window.addEventListener('hashchange', navigate);
window.addEventListener('DOMContentLoaded', navigate);
```

### Drag-and-Drop (HTML5 API)

```javascript
function handleDragStart(e) {
  e.dataTransfer.setData('text/plain', e.target.dataset.taskId);
  e.dataTransfer.effectAllowed = 'move';
  e.target.classList.add('dragging');
}

function handleDrop(e, targetStatus) {
  e.preventDefault();
  const taskId = e.dataTransfer.getData('text/plain');

  // Optimistic UI update
  moveTaskLocally(taskId, targetStatus);
  renderBoard();

  // Persist to server
  fetch(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: targetStatus })
  });
}
```

### Command Bar (Cmd+K)

Global keyboard shortcut opens an overlay for quick dispatch:

```javascript
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    toggleCommandBar();
  }
});

// Command bar accepts: "@agent message" or just "message" (routes to Jarvis)
function parseCommand(input) {
  const match = input.match(/^@(\w+)\s+(.+)$/);
  return match
    ? { agent: match[1], message: match[2] }
    : { agent: 'main', message: input };
}
```

---

## 4. Agent Integration

### Dispatch Flow

The Agent Dispatcher wraps `openclaw agent` CLI calls using `child_process.execFile` (not `exec` -- execFile does not spawn a shell, preventing command injection):

```javascript
const { execFile } = require('child_process');

function dispatchAgent(agentId, message, sessionId) {
  return new Promise((resolve, reject) => {
    const args = [
      'agent',
      '--agent', agentId,
      '--message', message,
      '--json',
    ];
    if (sessionId) args.push('--session-id', sessionId);

    execFile('openclaw', args, {
      timeout: 600000,   // 10 min default, matches OpenClaw default
      maxBuffer: 10 * 1024 * 1024,  // 10MB for large agent outputs
    }, (error, stdout, stderr) => {
      if (error) {
        reject({ error: error.message, stderr, code: error.code });
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch (parseErr) {
          resolve({ raw: stdout });  // non-JSON fallback
        }
      }
    });
  });
}
```

### Dispatch Lifecycle (Server-Side)

```
1. API receives POST /api/tasks/:id/dispatch
   or POST /api/dispatch (quick dispatch from command bar)

2. dispatchTransaction():
   - Update task status -> 'in_progress'
   - Insert agent_run (status='running')
   - Insert activity_log entry
   - bus.emit('agent:started', { run_id, agent_id, task_id })

3. dispatchAgent() called (async, non-blocking)
   - Spawns openclaw CLI as child process via execFile
   - Server continues handling other requests

4. On CLI completion:
   a. Parse JSON response
   b. completeRun() -> update agent_runs row
   c. Extract payloads[].text -> store as result_text
   d. Check deliveryStatus for errors
   e. Create notification if output is actionable
   f. Update task status if appropriate
   g. Insert activity_log entry
   h. bus.emit('agent:completed', { ... })
      or bus.emit('agent:failed', { ... })
```

### Concurrent Dispatch Tracking

Multiple agents can run simultaneously. The `agent_runs` table tracks each independently. The UI shows active runs with a spinner on the agent card.

```javascript
// Track running dispatches in memory for fast status checks
const activeDispatches = new Map();  // run_id -> { agentId, startTime, promise }

// Heartbeat: periodically emit progress for long-running dispatches
setInterval(() => {
  for (const [runId, info] of activeDispatches) {
    const elapsed = Date.now() - info.startTime;
    bus.emit('agent:progress', {
      run_id: runId,
      agent_id: info.agentId,
      elapsed_ms: elapsed,
      status: 'running'
    });
  }
}, 5000);
```

### OpenClaw CLI Response Parsing

Based on the actual CLI `--json` output format (verified from OpenClaw docs):

```javascript
function parseAgentResult(json) {
  return {
    text: json.payloads?.map(p => p.text).join('\n') || '',
    mediaUrls: json.payloads?.filter(p => p.mediaUrl).map(p => p.mediaUrl) || [],
    durationMs: json.meta?.durationMs || 0,
    transport: json.meta?.transport || 'gateway',
    deliveryStatus: json.deliveryStatus?.status || 'unknown',
    succeeded: json.deliveryStatus?.succeeded ?? true,
    wasFallback: !!json.meta?.fallbackFrom,
  };
}
```

### Agent Status Aggregation

Agent status cards pull from multiple sources:

```javascript
function getAgentStatus(agentId) {
  // From DB: latest run
  const lastRun = db.prepare(`
    SELECT * FROM agent_runs WHERE agent_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(agentId);

  // From memory: currently running?
  const isRunning = [...activeDispatches.values()]
    .some(d => d.agentId === agentId);

  // From CLI cache: agent config (refreshed every 5 min)
  const agentConfig = agentCache.get(agentId);

  return {
    id: agentId,
    name: agentConfig?.name || agentId,
    model: agentConfig?.model,
    isRunning,
    lastRun: lastRun ? {
      status: lastRun.status,
      duration_ms: lastRun.duration_ms,
      completed_at: lastRun.completed_at,
      summary: lastRun.result_text?.substring(0, 200),
    } : null,
    runCount: db.prepare(
      'SELECT COUNT(*) as c FROM agent_runs WHERE agent_id = ?'
    ).get(agentId).c,
  };
}
```

---

## 5. Data Flow: Complete Task Lifecycle

```
USER                BROWSER               SERVER                OPENCLAW
 |                     |                     |                     |
 |  Create task        |                     |                     |
 +-------------------->|                     |                     |
 |                     |  POST /api/tasks    |                     |
 |                     +-------------------->|                     |
 |                     |                     | INSERT tasks        |
 |                     |                     | INSERT activity_log |
 |                     |                     | bus.emit(task:created)
 |                     |  SSE: task:created  |                     |
 |                     |<--------------------+                     |
 |  See card appear    |                     |                     |
 |<--------------------+                     |                     |
 |                     |                     |                     |
 |  Click "Dispatch"   |                     |                     |
 +-------------------->|                     |                     |
 |                     | POST /tasks/:id/    |                     |
 |                     |      dispatch       |                     |
 |                     +-------------------->|                     |
 |                     |                     | BEGIN TRANSACTION   |
 |                     |                     |   UPDATE task->     |
 |                     |                     |     in_progress     |
 |                     |                     |   INSERT agent_run  |
 |                     |                     |     (running)       |
 |                     |                     |   INSERT activity   |
 |                     |                     | COMMIT              |
 |                     |                     |                     |
 |                     |                     | bus.emit(           |
 |                     |                     |   agent:started)    |
 |                     |  SSE: agent:started |                     |
 |                     |<--------------------+                     |
 |  See spinner on     |                     |                     |
 |  agent card         |                     |                     |
 |<--------------------+                     |                     |
 |                     |                     | execFile('openclaw',|
 |                     |                     |  ['agent',          |
 |                     |                     |   '--agent', id,    |
 |                     |                     |   '--message', msg, |
 |                     |                     |   '--json'])        |
 |                     |                     +-------------------->|
 |                     |                     |                     |
 |                     |                     | (5s heartbeat)      |
 |                     |                     | bus.emit(           |
 |                     |                     |   agent:progress)   |
 |                     | SSE: agent:progress |                     |
 |                     |<--------------------+                     |
 |  See elapsed time   |                     |                     |
 |<--------------------+                     |                     |
 |                     |                     |                     |
 |                     |                     |  JSON result        |
 |                     |                     |<--------------------+
 |                     |                     |                     |
 |                     |                     | BEGIN TRANSACTION   |
 |                     |                     |   UPDATE agent_run  |
 |                     |                     |     (completed)     |
 |                     |                     |   UPDATE task ->    |
 |                     |                     |     review          |
 |                     |                     |   INSERT            |
 |                     |                     |     notification    |
 |                     |                     |   INSERT activity   |
 |                     |                     | COMMIT              |
 |                     |                     |                     |
 |                     |                     | bus.emit(           |
 |                     |                     |  agent:completed)   |
 |                     |                     | bus.emit(           |
 |                     |                     |  task:updated)      |
 |                     |                     | bus.emit(           |
 |                     |                     |  notification:new)  |
 |                     | SSE: agent:completed|                     |
 |                     | SSE: task:updated   |                     |
 |                     | SSE: notification:  |                     |
 |                     |      new            |                     |
 |                     |<--------------------+                     |
 |  Card moves to      |                     |                     |
 |  "Review" column    |                     |                     |
 |  Notification badge |                     |                     |
 |  increments         |                     |                     |
 |<--------------------+                     |                     |
```

### Cron Output Capture

Cron jobs are managed by OpenClaw's gateway, not by Visionary. Visionary polls for cron results and displays them:

```javascript
// Poll OpenClaw cron runs periodically (every 2 min)
function pollCronRuns() {
  execFile('openclaw', ['cron', 'list', '--json'], (err, stdout) => {
    if (err) return;
    const { jobs } = JSON.parse(stdout);
    // Update cron display data, check for new completions
    for (const job of jobs) {
      if (job.state.lastRunAtMs > lastKnownCronRun[job.id]) {
        bus.emit('activity:new', {
          event_type: 'cron.completed',
          agent_id: job.agentId,
          summary: `Cron "${job.name}" ran (${job.state.lastStatus})`,
        });
        lastKnownCronRun[job.id] = job.state.lastRunAtMs;
      }
    }
  });
}
setInterval(pollCronRuns, 120000);
```

---

## 6. Build Order (Suggested)

Based on dependency analysis, build in this order:

```
Phase 1: Foundation
  1. db.js         -- schema, migrations, prepared statements
  2. server.js     -- HTTP server, router, static serve
  3. api.js        -- basic CRUD (tasks, projects)
  4. index.html    -- shell layout, nav, dark theme CSS

Phase 2: Core Board
  5. State store   -- Proxy-based reactive state
  6. Board view    -- Kanban columns, task cards
  7. Task CRUD UI  -- create/edit modal
  8. Drag-and-drop -- HTML5 DnD between columns

Phase 3: Agent Integration
  9. dispatcher.js -- execFile wrapper for openclaw CLI
  10. sse.js       -- SSE broker, event bus wiring
  11. Agent cards  -- status display, live updates
  12. Dispatch UI  -- button on tasks, command bar

Phase 4: Notifications + Activity
  13. Notification system -- DB, API, inbox UI
  14. Activity feed -- append-only log, live prepend via SSE
  15. Agent result viewer -- display formatted output

Phase 5: Views + Polish
  16. Cron viewer   -- poll + display schedule
  17. Brief/audit/portfolio viewers -- file readers
  18. Memory browser -- wiki search integration
  19. Interview mode -- task shaping before dispatch
```

---

## Patterns to Follow

### Pattern: Optimistic UI Updates

**What:** Update the UI immediately on user action, then sync with server. Roll back if server rejects.
**When:** Drag-drop, task creation, notification dismiss.
**Why:** The single-user, local-server setup means failures are rare. Instant feedback matters more than consistency guarantees.

### Pattern: Event-Driven Server

**What:** All mutations emit events on a shared EventEmitter bus. SSE, activity logging, and notifications all subscribe independently.
**When:** Every state change.
**Why:** Decouples concerns. Adding a new subscriber (e.g., future webhook) requires zero changes to existing code.

### Pattern: Prepared Statement Cache

**What:** Prepare all SQL statements once at startup, reuse via `stmt.run()` / `stmt.get()` / `stmt.all()`.
**When:** All database access.
**Why:** better-sqlite3's prepared statements are pre-compiled. Reusing them avoids parsing overhead and prevents SQL injection.

### Pattern: Graceful Degradation for Agent Status

**What:** If OpenClaw CLI is unreachable or gateway is down, show last-known state from DB rather than erroring.
**When:** Agent status checks, cron polling.
**Why:** The dashboard should always render. Agent infrastructure outages should degrade gracefully, not crash the UI.

---

## Anti-Patterns to Avoid

### Anti-Pattern: Full Page Re-renders

**What:** Replacing `document.body.innerHTML` on every state change.
**Why bad:** Destroys event listeners, causes flicker, loses scroll position, breaks drag state.
**Instead:** Target specific containers. Use `element.innerHTML` for the changed section only. For lists, prefer `insertAdjacentHTML` for appends.

### Anti-Pattern: Polling Instead of SSE

**What:** Using `setInterval` + `fetch` to check for updates.
**Why bad:** Wastes bandwidth, adds latency, creates unnecessary server load.
**Instead:** SSE for all real-time state. Only poll for external data (cron status from OpenClaw CLI) where SSE is not available.

### Anti-Pattern: Storing HTML in the Database

**What:** Saving rendered HTML from agent output directly into DB fields.
**Why bad:** Couples storage to presentation, XSS risk, cannot re-render differently later.
**Instead:** Store raw text/JSON. Render to HTML in component functions with proper escaping.

### Anti-Pattern: Global onclick Handlers

**What:** Putting `onclick="doThing()"` on every element.
**Why bad:** Pollutes global scope, hard to manage, breaks with innerHTML re-renders.
**Instead:** Use event delegation on parent containers:
```javascript
document.getElementById('board').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (btn) actions[btn.dataset.action](btn.dataset);
});
```

---

## Scalability Considerations

| Concern | Current (1 user) | If Multi-User Later |
|---------|------------------|---------------------|
| Database | SQLite WAL is fine | Stick with SQLite up to ~100 concurrent readers |
| SSE connections | 1-3 browser tabs | SSE scales to hundreds of connections easily |
| Agent dispatch | Sequential is fine | Use a job queue if >10 concurrent agents |
| State management | Single Proxy object | Would need per-user state isolation |
| Authentication | None needed | Add session cookie + bcrypt password check |

For a single-user local dashboard, none of these are concerns. The architecture is designed so each could be upgraded independently if scope grows.

---

## File Organization

```
visionary/
  server.js          -- entry point, HTTP server, router
  db.js              -- database init, schema, prepared statements
  api.js             -- REST route handlers
  dispatcher.js      -- OpenClaw CLI wrapper (uses execFile)
  sse.js             -- SSE broker + event bus
  public/
    index.html       -- SPA shell
    css/
      theme.css      -- dark ops-center theme
      board.css      -- kanban-specific styles
      components.css -- agent cards, notifications, etc.
    js/
      app.js         -- state store, router, init
      components/    -- render functions
        board.js
        agents.js
        inbox.js
        activity.js
        command-bar.js
        crons.js
        viewers.js
      utils.js       -- escaping, date formatting, fetch helpers
  visionary.sqlite   -- database (gitignored)
  package.json       -- only dep: better-sqlite3
```

**Alternative:** If "single server.js" is truly desired per PROJECT.md, all server modules can be inlined into one file (~800-1000 lines). The frontend can stay as separate files served statically, or be embedded as a template literal. The module approach above is recommended for maintainability but either works.

---

## Sources

- [MDN: Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
- [MDN: Using Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
- [MDN: Kanban Board with Drag and Drop](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/Kanban_board)
- [better-sqlite3 API Documentation](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
- [better-sqlite3 npm](https://www.npmjs.com/package/better-sqlite3)
- [OpenClaw CLI Agent Docs](https://docs.openclaw.ai/cli/agent)
- [Vanilla JS Component Pattern](https://dev.to/megazear7/the-vanilla-javascript-component-pattern-37la)
- [State-Based UI Components with Vanilla JS](https://gomakethings.com/how-to-create-a-state-based-ui-component-with-vanilla-js/)
- [Building Stateful Web Apps Without React](https://blog.logrocket.com/building-stateful-web-apps-without-react/)
- [SSE via Vanilla Node.js](https://medium.com/swlh/implement-sse-through-vanilla-nodejs-8b38cf20b7e0)
- [Node.js REST API Without Express](https://dev.to/burakboduroglu/building-a-nodejs-server-without-using-expressjs-3mc8)
- [Durable Message Queue on SQLite for Agent Orchestration](https://dev.to/minnzen/building-a-durable-message-queue-on-sqlite-for-ai-agent-orchestration-335m)
- [Understanding better-sqlite3](https://dev.to/lovestaco/understanding-better-sqlite3-the-fastest-sqlite-library-for-nodejs-4n8)
