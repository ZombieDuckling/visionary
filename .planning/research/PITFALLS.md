# Domain Pitfalls

**Domain:** Agent orchestration dashboard (web-based, single-user ops center)
**Project:** Visionary Mission Control
**Researched:** 2026-05-13

---

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or major operational failures.

---

### Pitfall 1: SQLite Corruption from Multi-Process Writes

**What goes wrong:** The Node.js server process and OpenClaw agent processes (or cron jobs writing results) attempt concurrent writes to the same SQLite database file. Without WAL mode and proper busy timeouts, you get SQLITE_BUSY errors that silently drop writes, or worse, database corruption if WAL/SHM files get separated from the main .db file (e.g., during backup or file move).

**Why it happens:** SQLite serializes all writes via a file-level lock. better-sqlite3 is synchronous, so a write blocks the Node.js event loop. If an agent process and the server both try to write simultaneously, one gets SQLITE_BUSY. Default behavior is to fail immediately with no retry.

**Consequences:**
- Lost task records, agent run history, or notifications
- Corrupted database requiring manual recovery
- Silent data loss (SQLITE_BUSY returned, error swallowed, user never knows)

**Warning signs:**
- Intermittent "database is locked" errors in logs
- Tasks or agent runs that "disappear" from the dashboard
- WAL file growing unbounded (checkpoint starvation from long-running reads)

**Prevention:**
1. Enable WAL mode on database open: `PRAGMA journal_mode=WAL;`
2. Set busy timeout: `PRAGMA busy_timeout=5000;` (5 seconds of retry)
3. Keep write transactions short -- batch inserts, avoid holding transactions open during agent dispatch
4. Run periodic checkpoints: `db.pragma('wal_checkpoint(RESTART)')` on a timer
5. **Single writer pattern:** Funnel ALL writes through the server process. Agent processes should POST results to the server's HTTP API, never write directly to SQLite
6. Never copy/move the .db file without also copying .db-wal and .db-shm

**Detection:** Add a health check that attempts a test write and logs timing. Alert if write latency exceeds 1 second.

**Phase:** Phase 1 (Foundation). Get this right before any data goes into the database. Retrofitting WAL mode and the single-writer pattern is painful.

**Confidence:** HIGH -- based on [SQLite official WAL documentation](https://sqlite.org/wal.html), [SQLite locking documentation](https://sqlite.org/lockingv3.html), and [better-sqlite3 performance docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md).

---

### Pitfall 2: Template Literal Escaping Nightmare (The Inception Problem)

**What goes wrong:** Embedding an entire SPA's HTML/CSS/JS inside a server.js template literal creates nested escaping hell. Backticks inside CSS (e.g., content properties), JavaScript strings within inline scripts, and dynamically generated HTML with user/agent data all require escaping at multiple levels. One unescaped backtick or `${` sequence breaks the entire page -- or worse, executes arbitrary expressions.

**Why it happens:** Template literals use backticks as delimiters and `${...}` for interpolation. When your HTML contains JavaScript that itself uses template literals (very common in modern JS), you get literal-inside-literal escaping. Every layer of nesting doubles the escaping complexity. The project description notes this has **already been hit**.

**Consequences:**
- Entire dashboard fails to render (syntax error in the template literal)
- XSS vulnerabilities: agent output containing `${...}` or backticks can inject code
- Debugging is brutal -- error points to "line 1" of a 3000+ line template literal
- Developer velocity craters as every HTML change risks breaking the template

**Warning signs:**
- "Unexpected token" errors that vanish and reappear unpredictably
- Agent output with backticks or dollar signs breaking the page
- Increasing fear of touching the HTML
- Bugs where agent-generated content (code snippets, log output) renders as executed JS

**Prevention:**
1. **Escape the boundary, not the content:** Serve the HTML from a separate .html file loaded with `fs.readFileSync()` rather than embedding in a template literal. The server just reads and serves the file -- zero escaping needed
2. If the template literal approach must stay: create a strict `escapeForTemplate()` function that escapes backticks and `${` sequences in ALL dynamic data before interpolation
3. Never use `innerHTML` with unsanitized agent output. Create a `sanitize()` function that strips/escapes HTML entities AND template literal metacharacters
4. For dynamic content in the SPA, use `textContent` (safe) instead of `innerHTML` (dangerous) wherever possible
5. Consider splitting: server.js serves the API, a separate static file serves the SPA. Still zero-dep, just two files

**Detection:** Test by injecting known-dangerous strings into every dynamic field: backtick-dollar-brace patterns, script closing tags, backtick-heavy strings. If the page breaks or an alert fires, you have a problem.

**Phase:** Phase 1 (Foundation). This is the #1 velocity killer. Fix the architecture (separate file or rigorous escaping) before building features on a fragile base.

**Confidence:** HIGH -- this is a known, already-encountered issue per the project context. Corroborated by [MDN template literal docs](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals) and [multiple XSS write-ups on template literal injection](https://popalltheshells.medium.com/xss-escape-backticks-strings-template-literals-92b3f31b37a8).

---

### Pitfall 3: Runaway Agents Burning Tokens and Blocking the System

**What goes wrong:** An agent dispatched via OpenClaw enters an infinite loop, hits an ambiguous tool result, or fails to reach a termination condition. It keeps consuming LLM tokens, API credits, and wall-clock time. The dashboard shows "In Progress" indefinitely. No kill switch, no budget enforcement, no timeout. A single runaway job can cost hundreds of dollars before anyone notices.

**Why it happens:** LLM agents are non-deterministic. A subtle prompt issue, an API returning unexpected results, or a tool that always returns ambiguous output can prevent termination. Multi-agent orchestration compounds this: the orchestrator's context grows with every sub-agent response (2,000 tokens per agent per cycle = 6,000+ tokens per orchestrator round-trip in a 3-agent pipeline).

**Consequences:**
- Unexpected API bills (potentially hundreds of dollars per runaway)
- Dashboard appears functional but agent is "working" with zero useful output
- Other agent dispatches blocked or delayed
- Context window exhaustion causes cascading failures

**Warning signs:**
- Agent task duration exceeding 10 minutes with no status updates
- Token usage per task exceeding historical averages by 5x+
- Agent producing repetitive output in logs
- Multiple agents queued but none completing

**Prevention:**
1. **Hard timeout per dispatch:** Use `execFile` with a `timeout` option (e.g., 300000ms = 5 minutes). Non-negotiable
2. **Token budget tracking:** Log estimated token usage per task. Alert when a single task exceeds a configurable threshold
3. **Kill switch in the UI:** A prominent "Abort" button on every running agent card that sends SIGTERM then SIGKILL
4. **Circuit breaker pattern:** After N consecutive failures or timeouts from the same agent, auto-disable dispatching to that agent and surface an alert
5. **Watchdog timer:** Background interval that checks all running agent processes and kills any exceeding max duration
6. **Cost estimation display:** Show estimated cost per agent run based on model and token count

**Detection:** Monitor child process PIDs. Track start time. Any process running beyond MAX_AGENT_DURATION triggers an alert and optional auto-kill.

**Phase:** Phase 2 (Agent Dispatch). Must be built into the dispatch system from day one, not bolted on after the first $200 surprise.

**Confidence:** HIGH -- based on [MindStudio's analysis of agent token budget management](https://www.mindstudio.ai/blog/ai-agent-token-budget-management-claude-code) and [Cogent's multi-agent failure playbook](https://cogentinfo.com/resources/when-ai-agents-collide-multi-agent-orchestration-failure-playbook-for-2026).

---

### Pitfall 4: Race Conditions in Multi-Agent State

**What goes wrong:** Two agents dispatched in parallel both try to update the same task record, project state, or shared resource. The second write silently overwrites the first. Or the orchestrator (Jarvis) dispatches a sub-agent, but the sub-agent's result arrives after the orchestrator has already moved on, causing the result to be silently dropped or misattributed.

**Why it happens:** Agent completion is non-deterministic in timing. The dashboard dispatches agents asynchronously via child processes, and completion callbacks arrive in unpredictable order. If the SQLite update logic is a simple SET without version checking, last-write-wins causes data loss.

**Consequences:**
- Task status jumps backward (e.g., "Done" reverts to "In Progress")
- Agent results attributed to the wrong task
- Duplicate dispatches of the same task (both agents think they should handle it)
- Orchestrator (Jarvis) re-dispatching work that was already completed

**Warning signs:**
- Task status flickering in the UI
- Agent results appearing under wrong tasks
- Duplicate entries in the activity feed
- "Ghost" tasks that can never reach Done status

**Prevention:**
1. **Optimistic locking:** Add an `updated_at` or `version` column to tasks. Every update includes a version check and verifies affected rows
2. **Agent dispatch queue:** Serialize dispatches through a FIFO queue rather than fire-and-forget parallel execution
3. **Idempotent result recording:** Agent results keyed by (agent_id, task_id, dispatch_timestamp) -- duplicates are ignored rather than overwriting
4. **Status state machine:** Tasks can only move forward through defined transitions (e.g., "In Progress" can become "Review" or "Failed", never back to "To Do" without explicit user action)

**Detection:** Log every state transition with before/after values and timestamp. Detect backward transitions in a nightly audit query.

**Phase:** Phase 2 (Agent Dispatch) for the queue and state machine. Phase 3 for the orchestrator pattern with Jarvis sub-delegation.

**Confidence:** MEDIUM -- pattern is well-documented in [race condition analysis for multi-agent systems](https://www.techaiapp.com/tech/handling-race-conditions-in-multi-agent-orchestration/) and standard database concurrency literature. Specifics to OpenClaw's behavior are inferred.

---

## Moderate Pitfalls

Mistakes that cause significant pain, rework, or degraded experience.

---

### Pitfall 5: SSE/Polling Memory Leaks and Stale Connections

**What goes wrong:** The dashboard opens a Server-Sent Events connection for real-time updates. If the client disconnects (browser tab closed, network blip) without the server detecting it, the server holds the response object in memory indefinitely. Over days of uptime, leaked connections accumulate and the Node.js process memory climbs toward OOM.

**Why it happens:** SSE connections are long-lived HTTP responses. The server registers an event listener per connection. If `req.on('close')` cleanup is missing or buggy, the listener and response object persist. Node.js won't GC them because they are still referenced in the listener array.

**Consequences:**
- Server memory grows linearly over time (each leaked connection ~10KB minimum, more if buffering data)
- MaxListenersExceededWarning flooding logs
- Eventually OOM crash, losing in-flight state
- Users see stale data and think the dashboard is live

**Warning signs:**
- Node.js process RSS climbing steadily over hours/days
- MaxListenersExceededWarning in stderr
- Dashboard showing data that is minutes/hours old despite "connected" indicator
- Server becomes sluggish after days of uptime

**Prevention:**
1. **Always clean up on close:** Every SSE connection must have `req.on('close', ...)` that removes from clients array and clears intervals
2. **Heartbeat/keepalive:** Send a comment line every 30 seconds. If the write fails, the connection is dead -- remove it
3. **Connection limit:** Cap active SSE connections (e.g., 5 for a single-user app). Reject or close oldest if limit exceeded
4. **Prefer polling for MVP:** Simple setInterval + fetch every 5 seconds is simpler, has no leak risk, and is perfectly adequate for a single-user dashboard. Upgrade to SSE only when polling latency becomes a real problem
5. **Client-side reconnection:** EventSource auto-reconnects on disconnect, but add Last-Event-ID support server-side so the client catches up on missed events

**Detection:** Monitor `process.memoryUsage().rss` on an interval. Log the count of active SSE connections. Alert if either grows monotonically.

**Phase:** Phase 1 for polling-based updates. Phase 3+ if upgrading to SSE for real-time activity feed.

**Confidence:** HIGH -- based on [Express SSE memory leak issue #2248](https://github.com/expressjs/express/issues/2248) and [SSE production readiness analysis](https://dev.to/miketalbot/server-sent-events-are-still-not-production-ready-after-a-decade-a-lesson-for-me-a-warning-for-you-2gie).

---

### Pitfall 6: OpenClaw CLI Integration Fragility

**What goes wrong:** The `openclaw agent --agent <id> --message "text" --json` command is the sole interface to agent dispatch. It fails in ways HTTP APIs don't: ANSI escape codes in output corrupt JSON parsing, the process hangs indefinitely if the gateway is down, stderr mixes with stdout, exit codes are unreliable, and shell metacharacters in the message parameter cause injection or truncation.

**Why it happens:** CLI tools are designed for human consumption. JSON mode may not suppress all ANSI codes. The OpenClaw gateway (port 18789) may be slow or unresponsive. Using shell-based execution adds escaping complexity and shell injection risk.

**Consequences:**
- JSON.parse throws on ANSI-polluted output, crashing the dispatch handler
- Agent dispatch hangs forever, blocking the task in "Dispatching" limbo
- Shell metacharacters in task descriptions (backticks, $, quotes) corrupt the command
- Partial output on timeout leads to truncated/corrupt results

**Warning signs:**
- SyntaxError: Unexpected token in JSON.parse calls
- Agent dispatches that never return (check for orphan child processes)
- Task descriptions with special characters failing silently
- stderr output appearing in parsed results

**Prevention:**
1. **Use execFile, not shell-based execution:** execFile does not spawn a shell, eliminating shell injection and metacharacter issues. Pass arguments as an array: `execFile('openclaw', ['agent', '--agent', id, '--message', message, '--json'])`
2. **Strip ANSI before parsing:** Apply a regex to remove ANSI escape sequences from stdout before JSON.parse
3. **Always set timeout:** 5 minutes via the timeout option. Handle the timeout error explicitly
4. **Separate stdout from stderr:** Capture both streams independently. Only parse stdout as JSON
5. **Gateway health check:** Before dispatching, verify the OpenClaw gateway is responsive with a lightweight probe (e.g., `openclaw health --json`)

**Detection:** Log raw stdout length, parse success/failure rate, and dispatch duration per agent. Alert on parse failure rate > 5%.

**Phase:** Phase 2 (Agent Dispatch). This is the mechanical foundation of the entire orchestration system.

**Confidence:** MEDIUM -- based on [Node.js child_process documentation](https://nodejs.org/api/child_process.html) and general CLI integration patterns. OpenClaw-specific behavior is inferred from the project description.

---

### Pitfall 7: Vanilla JS State Management Spaghetti

**What goes wrong:** Without a state management pattern, the single-file SPA accumulates ad-hoc DOM manipulation scattered across event handlers. Task state lives in the DOM (reading element.dataset or element.classList), agent status is cached in random global variables, and UI updates happen by directly mutating HTML elements. Eventually, the Kanban board shows a task as "Done" while the activity feed shows it "In Progress" because two different code paths update two different DOM nodes from two different data sources.

**Why it happens:** Vanilla JS SPAs start simple. The first few features use direct DOM manipulation and it works fine. But by feature #10, there are 15 global variables, 8 querySelector calls that find the wrong element when the DOM structure changes, and zero single source of truth for application state.

**Consequences:**
- UI inconsistencies: different parts of the page showing conflicting data
- Bugs that only reproduce in specific navigation sequences
- New features take exponentially longer as developers must trace state through DOM reads
- Refactoring becomes impossible because "everything depends on everything"

**Warning signs:**
- More than 5 global/module-level mutable variables holding UI state
- querySelector used to READ state (not just to update display)
- Functions that both fetch data AND update the DOM (mixed concerns)
- Difficulty answering "where is the current task list stored?"

**Prevention:**
1. **Central state store from day one:** A single state object with a setState function that triggers re-renders
2. **One-way data flow:** API fetch -> update state -> render DOM. Never read state from the DOM
3. **Render functions per component:** renderKanban(state.tasks), renderAgentCards(state.agents), etc. Each takes state as input, returns/updates DOM
4. **Event delegation:** Single event listener on a container element, dispatch based on event.target. Avoids listener leak when DOM is re-rendered
5. **Pub/Sub for cross-component updates:** When agent status changes, emit an event that both the agent card and the activity feed subscribe to

**Detection:** Code review. If you cannot answer "where does the application state live?" in one sentence, the pattern has degraded.

**Phase:** Phase 1 (Foundation). Establish the state management pattern before building any feature views. Retrofitting a state store into spaghetti DOM code is a near-rewrite.

**Confidence:** HIGH -- this is the universal vanilla JS SPA pitfall, well-documented across [CSS-Tricks state management guide](https://css-tricks.com/build-a-state-management-system-with-vanilla-javascript/) and the broader SPA literature.

---

## Minor Pitfalls

Mistakes that cause annoyance, minor bugs, or slow accumulation of tech debt.

---

### Pitfall 8: Dashboard Information Overload

**What goes wrong:** The ops center tries to show everything at once: 8 agent cards, Kanban board, activity feed, notification inbox, cron timeline, command bar, and project panels. The user's eyes glaze over. Critical alerts get lost in the noise. The "Bloomberg Terminal" aesthetic becomes a "Bloomberg Terminal minus 20 years of UX research" reality.

**Why it happens:** Excitement about capabilities. Every feature feels important. No one wants to hide their work behind a tab. The result is cognitive overload -- research shows operators facing information overload are slower to respond, more likely to misprioritize, and more prone to burnout.

**Prevention:**
1. **Progressive disclosure:** Show 5-7 key metrics on the main view. Everything else lives behind tabs, drilldowns, or expand-on-click
2. **Priority-based layout:** Critical alerts float to the top with visual urgency (color, size). Informational items are subdued
3. **Data freshness indicators:** Every panel shows "Updated 3s ago" or "Stale (5m)". Users should never wonder if they are looking at current data
4. **Notification tiers:** Critical (visual + sound), Warning (badge count), Info (feed only). Do NOT treat all notifications the same
5. **Limit visible agent cards:** Show only agents with active tasks expanded. Idle agents collapse to a single line

**Phase:** Phase 1 (Layout/Navigation) for the progressive disclosure architecture. Phase 3+ for notification tiering.

**Confidence:** HIGH -- based on [Smashing Magazine's real-time dashboard UX strategies](https://www.smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/) and [observability dashboard mistake analysis](https://logz.io/blog/top-10-mistakes-building-observability-dashboards/).

---

### Pitfall 9: Stale Data Masquerading as Live Data

**What goes wrong:** The dashboard polls every 30 seconds but the user assumes it is real-time. An agent completes a task, but the user dispatches a duplicate because the UI had not refreshed yet. Or the polling silently fails (network error, server restart) and the dashboard shows 20-minute-old data with no indication of staleness.

**Prevention:**
1. **Visible "last updated" timestamp** on every data panel, auto-updating relative ("3s ago", "2m ago")
2. **Visual staleness indicator:** Data older than 2x the poll interval gets a yellow border or "stale" badge
3. **Optimistic UI updates:** When the user dispatches a task, immediately update the local state. Don't wait for the next poll cycle to reflect the user's own action
4. **Error state for failed polls:** If a fetch fails, show a prominent "Connection lost" banner. Don't silently show old data
5. **Exponential backoff on failure:** Don't hammer a dead server with polls every 5 seconds. Back off, then show a reconnection notice

**Phase:** Phase 1 for the timestamp and error banner. Phase 2 for optimistic updates on dispatch.

**Confidence:** HIGH -- standard dashboard UX principle, documented in [dashboard UX pattern analysis](https://www.pencilandpaper.io/articles/ux-pattern-analysis-data-dashboards).

---

### Pitfall 10: Child Process Zombie Processes

**What goes wrong:** Agent dispatches via child processes that timeout or error leave orphan processes running. The parent records a timeout, but the openclaw process (and its sub-processes) continue running, consuming CPU and potentially still writing output. Over time, zombie processes accumulate.

**Prevention:**
1. **Kill the process tree, not just the parent:** Send SIGTERM followed by a delayed SIGKILL if the process does not exit within 5 seconds
2. **Track all child PIDs:** Maintain a Map of active dispatches with pid and startTime. On server shutdown, kill all
3. **Use detached: false** (the default) so child processes are attached to the parent's process group
4. **Periodic sweep:** Every 60 seconds, check tracked PIDs against existence. Clean up stale entries

**Phase:** Phase 2 (Agent Dispatch).

**Confidence:** MEDIUM -- based on [Node.js child_process docs](https://nodejs.org/api/child_process.html) and standard process management patterns.

---

### Pitfall 11: SQLite Schema Migration Pain

**What goes wrong:** The database schema evolves across phases (adding columns for agent token tracking, notification priorities, project links). Without a migration strategy, either the database must be wiped on upgrade (losing all task history) or migrations are done with ad-hoc ALTER TABLE statements that eventually conflict.

**Prevention:**
1. **Version table from day one:** `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER)`
2. **Migration array:** Ordered list of migration functions, each bumping the version. On startup, run all migrations above the current version
3. **Never modify existing migrations.** Only append new ones
4. **Backup before migration:** Copy the .db file (and .db-wal, .db-shm) before running migrations

**Phase:** Phase 1 (Foundation). The migration system must exist before the first schema is created.

**Confidence:** HIGH -- standard SQLite operational practice.

---

### Pitfall 12: Notification Fatigue from Cron Jobs

**What goes wrong:** 7 cron jobs generate notifications twice daily (security audits) or daily (morning brief, build, LinkedIn). The inbox fills with routine notifications. After a week, the user stops checking the inbox entirely, missing the one critical Sentinel alert buried between routine Scout briefs.

**Prevention:**
1. **Auto-dismiss routine notifications** after they have been displayed once (or after 24 hours)
2. **Severity classification at creation time:** Cron results are "Info" by default. Only anomalies (security finding, build failure) escalate to "Warning" or "Critical"
3. **Digest mode:** Collapse routine cron outputs into a single "Daily Digest" notification with expandable sections
4. **Smart filtering:** Show unread critical items first. Routine items in a separate "Activity" tab

**Phase:** Phase 3 (Inbox/Notifications).

**Confidence:** HIGH -- based on [alert fatigue analysis in cybersecurity dashboards](https://medium.com/design-bootcamp/alert-fatigue-and-dashboard-overload-why-cybersecurity-needs-better-ux-1f3bd32ad81c).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation | Severity |
|-------------|---------------|------------|----------|
| Phase 1: Foundation and Layout | Template literal escaping (Pitfall 2) | Separate HTML from server.js immediately | CRITICAL |
| Phase 1: Foundation and Layout | No state management pattern (Pitfall 7) | Central store + render functions from line 1 | CRITICAL |
| Phase 1: Foundation and Layout | SQLite WAL + busy_timeout not set (Pitfall 1) | First lines of database init code | CRITICAL |
| Phase 1: Foundation and Layout | No schema migration system (Pitfall 11) | Build before first CREATE TABLE | HIGH |
| Phase 2: Agent Dispatch | Runaway agents (Pitfall 3) | Timeout + kill switch + budget tracking | CRITICAL |
| Phase 2: Agent Dispatch | CLI integration fragility (Pitfall 6) | execFile + ANSI strip + timeout wrapper | HIGH |
| Phase 2: Agent Dispatch | Race conditions (Pitfall 4) | Dispatch queue + optimistic locking | HIGH |
| Phase 2: Agent Dispatch | Zombie processes (Pitfall 10) | PID tracking + process tree cleanup | MEDIUM |
| Phase 3: Real-time and Notifications | SSE memory leaks (Pitfall 5) | Start with polling; SSE only if needed | MEDIUM |
| Phase 3: Real-time and Notifications | Notification fatigue (Pitfall 12) | Severity tiers + auto-dismiss routine | MEDIUM |
| Phase 3: Real-time and Notifications | Stale data (Pitfall 9) | Freshness indicators + optimistic UI | MEDIUM |
| All Phases | Information overload (Pitfall 8) | Progressive disclosure, limit visible elements to 5-7 | MEDIUM |

---

## Summary of Prevention Priorities

**Before writing any feature code:**
1. Move HTML out of the template literal (or establish rigorous escaping)
2. Set up SQLite with WAL mode, busy_timeout, and migration system
3. Establish central state store + render pattern
4. Build the resilient agent dispatch wrapper with timeout, ANSI strip, execFile

**These four items prevent the four most expensive pitfalls.** Everything else can be addressed incrementally within its respective phase.

---

## Sources

- [SQLite WAL Documentation](https://sqlite.org/wal.html)
- [SQLite File Locking v3](https://sqlite.org/lockingv3.html)
- [better-sqlite3 Performance Docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md)
- [Fixing Concurrent Session Problems with SQLite WAL](https://dev.to/daichikudo/fixing-claude-codes-concurrent-session-problem-implementing-memory-mcp-with-sqlite-wal-mode-o7k)
- [Node.js child_process Documentation](https://nodejs.org/api/child_process.html)
- [MDN Template Literals](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals)
- [XSS Escape Backticks in Template Literals](https://popalltheshells.medium.com/xss-escape-backticks-strings-template-literals-92b3f31b37a8)
- [AI Agent Token Budget Management](https://www.mindstudio.ai/blog/ai-agent-token-budget-management-claude-code)
- [Multi-Agent Orchestration Failure Playbook](https://cogentinfo.com/resources/when-ai-agents-collide-multi-agent-orchestration-failure-playbook-for-2026)
- [Race Conditions in Multi-Agent Orchestration](https://www.techaiapp.com/tech/handling-race-conditions-in-multi-agent-orchestration/)
- [Why Multi-Agent Systems Fail: The 17x Error Trap](https://towardsdatascience.com/why-your-multi-agent-system-is-failing-escaping-the-17x-error-trap-of-the-bag-of-agents/)
- [Express SSE Memory Leak Issue](https://github.com/expressjs/express/issues/2248)
- [SSE Production Readiness Analysis](https://dev.to/miketalbot/server-sent-events-are-still-not-production-ready-after-a-decade-a-lesson-for-me-a-warning-for-you-2gie)
- [UX Strategies for Real-Time Dashboards](https://www.smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/)
- [Top 10 Mistakes in Observability Dashboards](https://logz.io/blog/top-10-mistakes-building-observability-dashboards/)
- [Alert Fatigue and Dashboard Overload](https://medium.com/design-bootcamp/alert-fatigue-and-dashboard-overload-why-cybersecurity-needs-better-ux-1f3bd32ad81c)
- [CSS-Tricks: State Management with Vanilla JavaScript](https://css-tricks.com/build-a-state-management-system-with-vanilla-javascript/)
- [Dashboard UX Pattern Analysis](https://www.pencilandpaper.io/articles/ux-pattern-analysis-data-dashboards)
