const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { execFile } = require('node:child_process');
const { db, stmts } = require('./db');
const { bus, handleSSE } = require('./sse');

// Read HTML file once at startup
const indexHTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

// MIME type map
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json'
};

// Agent configurations (module-level for dispatch validation + GET /api/agents)
const agentConfigs = [
  { id: 'jarvis', name: 'Jarvis', icon: '\u2699\uFE0F', role: 'Chief of Staff', model: 'claude-sonnet-4-20250514', color: '#3b8bff' },
  { id: 'scout', name: 'Scout', icon: '\uD83D\uDD2D', role: 'Morning Intelligence', model: 'claude-sonnet-4-20250514', color: '#06b6d4' },
  { id: 'analyst', name: 'Analyst', icon: '\uD83D\uDD2C', role: 'Research Deep-Diver', model: 'claude-sonnet-4-20250514', color: '#7c5cff' },
  { id: 'forge', name: 'Forge', icon: '\uD83D\uDD28', role: 'Builder', model: 'claude-sonnet-4-20250514', color: '#f59e0b' },
  { id: 'sentinel', name: 'Sentinel', icon: '\uD83D\uDEE1\uFE0F', role: 'Security Monitor', model: 'llama3.2:3b', color: '#ef4444' },
  { id: 'broker', name: 'Broker', icon: '\uD83D\uDCC8', role: 'Investment Intelligence', model: 'claude-sonnet-4-20250514', color: '#22c55e' },
  { id: 'ops', name: 'Ops', icon: '\uD83D\uDDA5\uFE0F', role: 'Infrastructure & DevOps', model: 'llama3.2:3b', color: '#8b5cf6' },
  { id: 'hunter', name: 'Hunter', icon: '\uD83C\uDFAF', role: 'Career & Opportunities', model: 'claude-sonnet-4-20250514', color: '#ec4899' }
];
const validAgentIds = agentConfigs.map(a => a.id);

// Track running agent processes for kill switch
// Map<runId, { process, agentId, taskId, startTime }>
const activeDispatches = new Map();

// Strip ANSI escape codes from CLI output
function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

// Clean CLI output: strip ANSI + remove [plugins] warning lines that corrupt JSON
function cleanCliOutput(raw) {
  return stripAnsi(raw)
    .split('\n')
    .filter(line => !line.startsWith('[plugins]'))
    .join('\n')
    .trim();
}

// Dispatch an agent via OpenClaw CLI
function dispatchAgent(taskId, agentId, message) {
  const startTime = Date.now();

  // Transaction: update task status, insert run, insert activity
  const doTransaction = db.transaction(() => {
    const task = stmts.getTaskById.get(taskId);
    if (task) {
      stmts.updateTask.run({
        id: taskId,
        title: task.title,
        description: task.description,
        status: 'in_progress',
        priority: task.priority,
        agent_id: task.agent_id || agentId,
        sort_order: task.sort_order
      });
    }
    const result = stmts.insertRun.run({ task_id: taskId, agent_id: agentId, message });
    const runId = Number(result.lastInsertRowid);
    stmts.insertActivity.run({
      event_type: 'agent.dispatched',
      agent_id: agentId,
      task_id: taskId,
      project_id: null,
      summary: 'Dispatched ' + agentId + ' for task #' + taskId,
      detail_json: JSON.stringify({ run_id: runId, message })
    });
    return { runId, updatedTask: stmts.getTaskById.get(taskId) };
  });

  const { runId, updatedTask } = doTransaction();

  // Emit SSE events after transaction
  bus.emit('agent:started', { run_id: runId, agent_id: agentId, task_id: taskId });
  if (updatedTask) bus.emit('task:updated', updatedTask);
  bus.emit('activity:new', { event_type: 'agent.dispatched', agent_id: agentId, task_id: taskId, summary: 'Dispatched ' + agentId + ' for task #' + taskId });

  // Spawn CLI process (execFile -- no shell, prevents injection)
  const child = execFile('openclaw', [
    'agent', '--agent', agentId,
    '--message', message,
    '--json',
    '--timeout', '600'
  ], {
    timeout: 660000,       // 11 min hard kill (above CLI's 10 min)
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, PATH: process.env.PATH + ':/opt/homebrew/bin:/usr/local/bin' }
  }, (error, stdout, stderr) => {
    const durationMs = Date.now() - startTime;

    if (!error) {
      // Success
      const cleaned = cleanCliOutput(stdout);
      let resultText = cleaned;
      try {
        const parsed = JSON.parse(cleaned);
        if (parsed.payloads && Array.isArray(parsed.payloads)) {
          resultText = parsed.payloads.map(p => p.text).join('\n');
        } else if (parsed.result) {
          resultText = typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result);
        }
      } catch {
        // Not valid JSON -- use cleaned stdout as-is
      }

      stmts.completeRun.run({
        id: runId, status: 'completed', result_json: cleaned,
        result_text: resultText, error: null, duration_ms: durationMs
      });

      // Update task to review
      const currentTask = stmts.getTaskById.get(taskId);
      if (currentTask) {
        stmts.updateTask.run({
          id: taskId, title: currentTask.title, description: currentTask.description,
          status: 'review', priority: currentTask.priority,
          agent_id: currentTask.agent_id, sort_order: currentTask.sort_order
        });
        const reviewTask = stmts.getTaskById.get(taskId);
        bus.emit('task:updated', reviewTask);
      }

      stmts.insertActivity.run({
        event_type: 'agent.completed', agent_id: agentId, task_id: taskId,
        project_id: null, summary: agentId + ' completed task #' + taskId + ' (' + Math.round(durationMs / 1000) + 's)',
        detail_json: JSON.stringify({ run_id: runId, duration_ms: durationMs })
      });

      bus.emit('agent:completed', {
        run_id: runId, agent_id: agentId, task_id: taskId,
        duration_ms: durationMs, result_text: resultText ? resultText.substring(0, 200) : ''
      });
      bus.emit('activity:new', {
        event_type: 'agent.completed', agent_id: agentId, task_id: taskId,
        summary: agentId + ' completed task #' + taskId + ' (' + Math.round(durationMs / 1000) + 's)'
      });
    } else {
      // Error / timeout
      const status = error.killed ? 'timeout' : 'failed';
      stmts.completeRun.run({
        id: runId, status, result_json: null, result_text: null,
        error: error.message, duration_ms: durationMs
      });

      // Do NOT change task status -- leave in_progress for retry
      const errSummary = agentId + ' ' + status + ' on task #' + taskId + ': ' + error.message.substring(0, 100);
      stmts.insertActivity.run({
        event_type: 'agent.' + status, agent_id: agentId, task_id: taskId,
        project_id: null, summary: errSummary,
        detail_json: JSON.stringify({ run_id: runId, error: error.message, duration_ms: durationMs })
      });

      bus.emit('agent:failed', {
        run_id: runId, agent_id: agentId, task_id: taskId,
        error: error.message, duration_ms: durationMs
      });
      bus.emit('activity:new', {
        event_type: 'agent.' + status, agent_id: agentId, task_id: taskId, summary: errSummary
      });
    }

    // Cleanup
    activeDispatches.delete(runId);
  });

  activeDispatches.set(runId, { process: child, agentId, taskId, startTime });
  return runId;
}

// Helper: read request body and JSON.parse it
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve(null);
      }
    });
  });
}

// Static file server
const PUBLIC_DIR = path.join(__dirname, 'public');

function serveStatic(pathname, res) {
  const filePath = path.join(PUBLIC_DIR, pathname);
  // Guard against directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch {
    // SPA fallback: serve index.html for unknown paths
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(indexHTML);
  }
}

// Router
const server = http.createServer(async (req, res) => {
  try {
    // JSON response helper
    res.json = (data, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const method = req.method;

    // GET / -> serve index HTML
    if (method === 'GET' && pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(indexHTML);
      return;
    }

    // API routes
    if (pathname.startsWith('/api/')) {
      // GET /api/tasks
      if (method === 'GET' && pathname === '/api/tasks') {
        const tasks = stmts.getAllTasks.all();
        res.json({ tasks });
        return;
      }

      // POST /api/tasks
      if (method === 'POST' && pathname === '/api/tasks') {
        const body = await readBody(req);
        if (!body || !body.title || typeof body.title !== 'string' || !body.title.trim()) {
          res.json({ error: 'title is required' }, 400);
          return;
        }
        const result = stmts.insertTask.run({
          title: body.title.trim(),
          description: body.description || null,
          status: body.status || 'todo',
          priority: body.priority || 'medium',
          agent_id: body.agent_id || null,
          project_id: body.project_id || null,
          sort_order: body.sort_order || 0
        });
        const task = stmts.getTaskById.get(result.lastInsertRowid);
        stmts.insertActivity.run({
          event_type: 'task.created',
          agent_id: null,
          task_id: task.id,
          project_id: task.project_id,
          summary: 'Task created: ' + task.title,
          detail_json: JSON.stringify(task)
        });
        bus.emit('task:created', task);
        bus.emit('activity:new', { event_type: 'task.created', summary: 'Task created: ' + task.title, task_id: task.id });
        res.json({ task }, 201);
        return;
      }

      // PATCH /api/tasks/:id
      if (method === 'PATCH' && pathname.startsWith('/api/tasks/')) {
        const id = parseInt(pathname.split('/')[3], 10);
        if (isNaN(id)) { res.json({ error: 'Invalid task id' }, 400); return; }
        const existing = stmts.getTaskById.get(id);
        if (!existing) { res.json({ error: 'Task not found' }, 404); return; }
        const body = await readBody(req);
        if (!body) { res.json({ error: 'Request body required' }, 400); return; }
        const statusChanged = body.status && body.status !== existing.status;
        stmts.updateTask.run({
          id,
          title: body.title !== undefined ? body.title : existing.title,
          description: body.description !== undefined ? body.description : existing.description,
          status: body.status !== undefined ? body.status : existing.status,
          priority: body.priority !== undefined ? body.priority : existing.priority,
          agent_id: body.agent_id !== undefined ? body.agent_id : existing.agent_id,
          sort_order: body.sort_order !== undefined ? body.sort_order : existing.sort_order
        });
        const updatedTask = stmts.getTaskById.get(id);
        const eventType = statusChanged ? 'task.moved' : 'task.updated';
        stmts.insertActivity.run({
          event_type: eventType,
          agent_id: null,
          task_id: updatedTask.id,
          project_id: updatedTask.project_id,
          summary: statusChanged
            ? `Task moved: ${updatedTask.title} -> ${updatedTask.status}`
            : `Task updated: ${updatedTask.title}`,
          detail_json: JSON.stringify(updatedTask)
        });
        bus.emit('task:updated', updatedTask);
        bus.emit('activity:new', { event_type: eventType, summary: `Task ${statusChanged ? 'moved' : 'updated'}: ${updatedTask.title}`, task_id: updatedTask.id });
        res.json({ task: updatedTask });
        return;
      }

      // DELETE /api/tasks/:id
      if (method === 'DELETE' && pathname.startsWith('/api/tasks/')) {
        const id = parseInt(pathname.split('/')[3], 10);
        if (isNaN(id)) { res.json({ error: 'Invalid task id' }, 400); return; }
        const existing = stmts.getTaskById.get(id);
        if (!existing) { res.json({ error: 'Task not found' }, 404); return; }
        stmts.deleteTask.run(id);
        stmts.insertActivity.run({
          event_type: 'task.deleted',
          agent_id: null,
          task_id: existing.id,
          project_id: existing.project_id,
          summary: 'Task deleted: ' + existing.title,
          detail_json: JSON.stringify(existing)
        });
        bus.emit('task:deleted', { id });
        bus.emit('activity:new', { event_type: 'task.deleted', summary: 'Task deleted: ' + existing.title, task_id: existing.id });
        res.json({ ok: true });
        return;
      }

      // GET /api/events -> SSE endpoint
      if (method === 'GET' && pathname === '/api/events') {
        handleSSE(req, res);
        return;
      }

      // GET /api/activity
      if (method === 'GET' && pathname === '/api/activity') {
        const limitParam = parseInt(url.searchParams.get('limit'), 10);
        const limit = (!isNaN(limitParam) && limitParam > 0) ? Math.min(limitParam, 200) : 50;
        const activity = stmts.getRecentActivity.all(limit);
        res.json({ activity });
        return;
      }

      // GET /api/agents
      if (method === 'GET' && pathname === '/api/agents') {
        const latestRuns = stmts.getLatestRunPerAgent.all();
        const runningAgents = stmts.getRunningAgents.all().map(r => r.agent_id);
        const runMap = {};
        latestRuns.forEach(function (r) { runMap[r.agent_id] = r; });
        const agents = agentConfigs.map(function (cfg) {
          const run = runMap[cfg.id];
          let status = 'idle';
          if (runningAgents.indexOf(cfg.id) !== -1) {
            status = 'active';
          } else if (run && run.status === 'failed') {
            status = 'error';
          }
          return {
            id: cfg.id,
            name: cfg.name,
            icon: cfg.icon,
            role: cfg.role,
            model: cfg.model,
            color: cfg.color,
            status: status,
            last_activity: run ? (run.completed_at || run.started_at) : null,
            last_run_status: run ? run.status : null,
            last_run_duration_ms: run ? run.duration_ms : null,
            last_run_summary: run && run.result_text ? run.result_text.substring(0, 120) : null
          };
        });
        res.json({ agents });
        return;
      }

      // POST /api/dispatch -- dispatch agent to work on a task
      if (method === 'POST' && pathname === '/api/dispatch') {
        const body = await readBody(req);
        if (!body) { res.json({ error: 'Request body required' }, 400); return; }

        let taskId, agentId, message;

        if (body.task_id) {
          // Mode A: dispatch existing task
          const task = stmts.getTaskById.get(body.task_id);
          if (!task) { res.json({ error: 'Task not found' }, 404); return; }
          taskId = task.id;
          agentId = body.agent_id || task.agent_id;
          message = body.message || (task.title + (task.description ? ': ' + task.description : ''));
        } else if (body.agent_id && body.message) {
          // Mode B: create task + dispatch
          agentId = body.agent_id;
          message = body.message;
          const result = stmts.insertTask.run({
            title: message.substring(0, 100),
            description: message,
            status: 'todo',
            priority: 'medium',
            agent_id: agentId,
            project_id: null,
            sort_order: 0
          });
          taskId = Number(result.lastInsertRowid);
          const newTask = stmts.getTaskById.get(taskId);
          stmts.insertActivity.run({
            event_type: 'task.created', agent_id: null, task_id: taskId,
            project_id: null, summary: 'Task created: ' + newTask.title,
            detail_json: JSON.stringify(newTask)
          });
          bus.emit('task:created', newTask);
          bus.emit('activity:new', { event_type: 'task.created', summary: 'Task created: ' + newTask.title, task_id: taskId });
        } else {
          res.json({ error: 'Provide task_id or both agent_id and message' }, 400);
          return;
        }

        if (!agentId) {
          res.json({ error: 'No agent specified. Provide agent_id or assign one to the task.' }, 400);
          return;
        }

        // Validate agent_id against allowlist (T-03-01 mitigation)
        if (validAgentIds.indexOf(agentId) === -1) {
          res.json({ error: 'Unknown agent: ' + agentId + '. Valid agents: ' + validAgentIds.join(', ') }, 400);
          return;
        }

        const runId = dispatchAgent(taskId, agentId, message);
        res.json({ run_id: runId, agent_id: agentId, task_id: taskId }, 202);
        return;
      }

      // POST /api/dispatch/:runId/kill -- kill a running agent process
      if (method === 'POST' && /^\/api\/dispatch\/(\d+)\/kill$/.test(pathname)) {
        const runId = parseInt(pathname.match(/^\/api\/dispatch\/(\d+)\/kill$/)[1], 10);
        const info = activeDispatches.get(runId);
        if (!info) {
          res.json({ error: 'No active dispatch with run_id ' + runId }, 404);
          return;
        }

        // SIGTERM first, SIGKILL fallback after 5s
        try { info.process.kill('SIGTERM'); } catch {}
        setTimeout(() => {
          try { info.process.kill('SIGKILL'); } catch {}
        }, 5000);

        const durationMs = Date.now() - info.startTime;
        stmts.completeRun.run({
          id: runId, status: 'failed', result_json: null, result_text: null,
          error: 'Killed by user', duration_ms: durationMs
        });

        const killSummary = 'Agent ' + info.agentId + ' killed by user for task #' + info.taskId;
        stmts.insertActivity.run({
          event_type: 'agent.killed', agent_id: info.agentId, task_id: info.taskId,
          project_id: null, summary: killSummary,
          detail_json: JSON.stringify({ run_id: runId, duration_ms: durationMs })
        });

        bus.emit('agent:failed', {
          run_id: runId, agent_id: info.agentId, task_id: info.taskId,
          error: 'Killed by user', duration_ms: durationMs
        });
        bus.emit('activity:new', {
          event_type: 'agent.killed', agent_id: info.agentId, task_id: info.taskId, summary: killSummary
        });

        activeDispatches.delete(runId);
        res.json({ ok: true, run_id: runId });
        return;
      }

      // GET /api/runs -- agent run history
      if (method === 'GET' && pathname === '/api/runs') {
        const taskIdParam = url.searchParams.get('task_id');
        let runs;
        if (taskIdParam) {
          runs = stmts.getRunsByTask.all(parseInt(taskIdParam, 10));
        } else {
          runs = stmts.getRecentRuns.all(20);
        }
        res.json({ runs });
        return;
      }

      // GET /api/notifications (placeholder -- consumed in Phase 4)
      if (method === 'GET' && pathname === '/api/notifications') {
        res.json({ notifications: [] });
        return;
      }

      // Default for /api/* -> 404
      res.json({ error: 'Not found' }, 404);
      return;
    }

    // Everything else -> static file serve
    serveStatic(pathname, res);
  } catch (err) {
    console.error('Server error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

server.listen(3333, '127.0.0.1', () => {
  console.log('Visionary Mission Control running at http://127.0.0.1:3333');
});

// Heartbeat: broadcast progress for active dispatches every 5 seconds
setInterval(() => {
  for (const [runId, info] of activeDispatches) {
    bus.emit('agent:progress', {
      run_id: runId, agent_id: info.agentId, task_id: info.taskId,
      elapsed_ms: Date.now() - info.startTime, status: 'running'
    });
  }
}, 5000);

// Graceful shutdown -- kill active dispatches first
process.on('SIGINT', () => {
  for (const [, info] of activeDispatches) {
    try { info.process.kill('SIGTERM'); } catch {}
  }
  db.close();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  for (const [, info] of activeDispatches) {
    try { info.process.kill('SIGTERM'); } catch {}
  }
  db.close();
  server.close();
  process.exit(0);
});
