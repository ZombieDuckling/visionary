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
  { id: 'hunter', name: 'Hunter', icon: '\uD83C\uDFAF', role: 'Career & Opportunities', model: 'claude-sonnet-4-20250514', color: '#ec4899' },
  { id: 'reviewer', name: 'Reviewer', icon: '\uD83D\uDD0D', role: 'Quality Gate & Review', model: 'claude-sonnet-4-20250514', color: '#f97316' }
];
const validAgentIds = agentConfigs.map(a => a.id);

// INTEL-02: Jarvis auto-routing — keyword matching to select best agent
function routeToAgent(description) {
  const lower = (description || '').toLowerCase();
  const routeMap = [
    { agent_id: 'sentinel', keywords: ['security', 'audit', 'vulnerability', 'pentest', 'scan', 'threat', 'cyber'] },
    { agent_id: 'scout', keywords: ['news', 'brief', 'morning', 'intelligence', 'scan', 'summary', 'digest'] },
    { agent_id: 'analyst', keywords: ['research', 'analysis', 'deep-dive', 'investigate', 'report', 'data', 'compare'] },
    { agent_id: 'forge', keywords: ['build', 'code', 'dashboard', 'automate', 'script', 'deploy', 'feature', 'fix', 'bug'] },
    { agent_id: 'broker', keywords: ['invest', 'portfolio', 'market', 'stock', 'finance', 'trading', 'crypto'] },
    { agent_id: 'ops', keywords: ['infra', 'docker', 'server', 'devops', 'nginx', 'kubernetes', 'backup'] },
    { agent_id: 'hunter', keywords: ['job', 'career', 'cv', 'resume', 'linkedin', 'opportunity'] }
  ];

  for (let i = 0; i < routeMap.length; i++) {
    const matched = routeMap[i].keywords.filter(function (kw) { return lower.indexOf(kw) !== -1; });
    if (matched.length > 0) {
      return {
        agent_id: routeMap[i].agent_id,
        confidence: matched.length >= 2 ? 'high' : 'medium',
        matched_keywords: matched
      };
    }
  }
  return { agent_id: 'jarvis', confidence: 'low', matched_keywords: [] };
}

// Track running agent processes for kill switch
// Map<runId, { process, agentId, taskId, startTime }>
const activeDispatches = new Map();

// Auto-review: dispatch Reviewer agent to evaluate completed work
function triggerReview(taskId, runId, originalAgent, resultText) {
  const task = stmts.getTaskById.get(taskId);
  if (!task) return;

  const reviewPrompt = 'Review the output from agent "' + originalAgent + '" on task #' + taskId + ': "' + (task.title || '').replace(/"/g, '\\"') + '".\n\n'
    + 'Task description: ' + (task.description || 'None').replace(/"/g, '\\"') + '\n\n'
    + 'Agent output (first 2000 chars):\n' + (resultText || 'No output captured').substring(0, 2000).replace(/"/g, '\\"') + '\n\n'
    + 'Evaluate for completeness, quality, correctness, and actionability.\n'
    + 'Respond with EXACTLY one of these formats:\n'
    + 'APPROVE: [one-line summary of what was delivered]\n'
    + 'REJECT: [specific issues that need fixing]\n\n'
    + 'Be strict. Only approve work that Josh can use immediately.';

  const args = ['agent', '--agent', 'reviewer', '--message', reviewPrompt, '--json', '--timeout', '120'];
  const env = Object.assign({}, process.env, { PATH: process.env.PATH + ':/opt/homebrew/bin:/usr/local/bin' });

  const reviewRun = stmts.insertRun.run({
    task_id: taskId, agent_id: 'reviewer', session_id: null,
    message: 'Reviewing ' + originalAgent + ' output on task #' + taskId,
    status: 'running'
  });
  const reviewRunId = Number(reviewRun.lastInsertRowid);

  stmts.insertActivity.run({
    event_type: 'review.started', agent_id: 'reviewer', task_id: taskId,
    project_id: task.project_id, summary: 'Reviewer evaluating ' + originalAgent + ' output on "' + task.title + '"',
    detail_json: JSON.stringify({ original_agent: originalAgent, original_run: runId })
  });
  bus.emit('activity:new', { event_type: 'review.started', agent_id: 'reviewer', task_id: taskId, summary: 'Reviewing ' + originalAgent + ' output' });

  const startTime = Date.now();
  const child = execFile('openclaw', args, { env, timeout: 130000, maxBuffer: 4 * 1024 * 1024 }, function (error, stdout, stderr) {
    const durationMs = Date.now() - startTime;
    const output = cleanCliOutput(stdout || '');

    if (!error && output) {
      stmts.completeRun.run({ id: reviewRunId, status: 'completed', result_json: null, result_text: output, error: null, duration_ms: durationMs });

      const upperOutput = output.toUpperCase();
      if (upperOutput.indexOf('APPROVE') !== -1) {
        // Move task to done
        stmts.updateTask.run({
          id: taskId, title: task.title, description: task.description,
          status: 'done', priority: task.priority,
          agent_id: task.agent_id, sort_order: task.sort_order
        });
        const doneTask = stmts.getTaskById.get(taskId);
        bus.emit('task:updated', doneTask);

        const approveMatch = output.match(/APPROVE[:\s]*(.*)/i);
        const summary = approveMatch ? approveMatch[1].trim().substring(0, 200) : 'Work approved';

        stmts.insertNotification.run({ agent_run_id: reviewRunId, type: 'info', title: 'Reviewer approved task #' + taskId, body: summary, action_type: 'view_task', action_data: JSON.stringify({ task_id: taskId }) });
        stmts.insertActivity.run({ event_type: 'review.approved', agent_id: 'reviewer', task_id: taskId, project_id: task.project_id, summary: 'Approved: ' + task.title + ' — ' + summary, detail_json: null });
        bus.emit('activity:new', { event_type: 'review.approved', agent_id: 'reviewer', task_id: taskId, summary: 'Approved: ' + summary });

      } else if (upperOutput.indexOf('REJECT') !== -1) {
        // Move task back to todo and redeploy original agent
        stmts.updateTask.run({
          id: taskId, title: task.title, description: task.description,
          status: 'todo', priority: task.priority,
          agent_id: task.agent_id, sort_order: task.sort_order
        });
        const todoTask = stmts.getTaskById.get(taskId);
        bus.emit('task:updated', todoTask);

        const rejectMatch = output.match(/REJECT[:\s]*(.*)/i);
        const feedback = rejectMatch ? rejectMatch[1].trim().substring(0, 500) : 'Quality issues found';

        stmts.insertNotification.run({ agent_run_id: reviewRunId, type: 'warning', title: 'Reviewer rejected task #' + taskId, body: feedback + ' — Redeploying ' + originalAgent, action_type: 'view_task', action_data: JSON.stringify({ task_id: taskId }) });
        stmts.insertActivity.run({ event_type: 'review.rejected', agent_id: 'reviewer', task_id: taskId, project_id: task.project_id, summary: 'Rejected: ' + task.title + ' — ' + feedback, detail_json: null });
        bus.emit('activity:new', { event_type: 'review.rejected', agent_id: 'reviewer', task_id: taskId, summary: 'Rejected: ' + feedback });

        // Redeploy original agent with review feedback
        setTimeout(function () {
          const redeployMsg = 'Your previous work on task "' + task.title + '" was reviewed and rejected. Feedback: ' + feedback + '\n\nOriginal task: ' + (task.description || task.title) + '\n\nPlease fix the issues and redo the work.';
          const redeployArgs = ['agent', '--agent', originalAgent, '--message', redeployMsg, '--json', '--timeout', '600'];

          const redeployRun = stmts.insertRun.run({ task_id: taskId, agent_id: originalAgent, session_id: null, message: 'Redeploy after review rejection', status: 'running' });
          const redeployRunId = Number(redeployRun.lastInsertRowid);

          stmts.updateTask.run({ id: taskId, title: task.title, description: task.description, status: 'in_progress', priority: task.priority, agent_id: originalAgent, sort_order: task.sort_order });
          bus.emit('task:updated', stmts.getTaskById.get(taskId));
          bus.emit('activity:new', { event_type: 'agent.redeployed', agent_id: originalAgent, task_id: taskId, summary: originalAgent + ' redeployed on "' + task.title + '" after review rejection' });

          const redeployStart = Date.now();
          execFile('openclaw', redeployArgs, { env, timeout: 610000, maxBuffer: 4 * 1024 * 1024 }, function (err2, stdout2) {
            const dur2 = Date.now() - redeployStart;
            const out2 = cleanCliOutput(stdout2 || '');
            if (!err2 && out2) {
              stmts.completeRun.run({ id: redeployRunId, status: 'completed', result_json: null, result_text: out2, error: null, duration_ms: dur2 });
              stmts.updateTask.run({ id: taskId, title: task.title, description: task.description, status: 'review', priority: task.priority, agent_id: originalAgent, sort_order: task.sort_order });
              bus.emit('task:updated', stmts.getTaskById.get(taskId));
              // Trigger review again
              triggerReview(taskId, redeployRunId, originalAgent, out2);
            } else {
              stmts.completeRun.run({ id: redeployRunId, status: 'failed', result_json: null, result_text: null, error: (err2 || {}).message || 'unknown', duration_ms: dur2 });
            }
          });
        }, 2000);
      }
    } else {
      stmts.completeRun.run({ id: reviewRunId, status: 'failed', result_json: null, result_text: null, error: (error || {}).message || 'unknown', duration_ms: durationMs });
    }
  });
  child.unref();
}

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

      // INTEL-04: Parse token usage from CLI JSON output and estimate cost
      try {
        const parsed = JSON.parse(cleaned);
        const usage = parsed.usage || parsed.token_usage || (parsed.metrics && parsed.metrics);
        if (usage && (usage.input_tokens || usage.output_tokens)) {
          const inputTok = usage.input_tokens || 0;
          const outputTok = usage.output_tokens || 0;
          const agentCfg = agentConfigs.find(function (c) { return c.id === agentId; });
          const isLlama = agentCfg && agentCfg.model && agentCfg.model.indexOf('llama') !== -1;
          const cost = isLlama
            ? (inputTok * 0.0001 + outputTok * 0.0001) / 1000
            : (inputTok * 0.003 + outputTok * 0.015) / 1000;
          stmts.updateRunTokens.run({ id: runId, input_tokens: inputTok, output_tokens: outputTok, estimated_cost_usd: cost });
        }
      } catch (_tokenErr) { /* not valid JSON or no usage data */ }

      // Create notification for completed run
      const notifResult = stmts.insertNotification.run({
        agent_run_id: runId,
        type: 'info',
        title: agentId.charAt(0).toUpperCase() + agentId.slice(1) + ' completed task #' + taskId,
        body: resultText ? resultText.substring(0, 500) : 'No output',
        action_type: 'view_run',
        action_data: JSON.stringify({ run_id: runId, task_id: taskId })
      });
      bus.emit('notification:created', {
        id: Number(notifResult.lastInsertRowid),
        agent_id: agentId, task_id: taskId, type: 'info',
        title: agentId.charAt(0).toUpperCase() + agentId.slice(1) + ' completed task #' + taskId
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

      // Auto-trigger Reviewer on completed tasks
      if (agentId !== 'reviewer') {
        triggerReview(taskId, runId, agentId, resultText);
      }
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

      // Create notification for failed/timed-out run
      const failNotifResult = stmts.insertNotification.run({
        agent_run_id: runId,
        type: status === 'timeout' ? 'warning' : 'error',
        title: agentId.charAt(0).toUpperCase() + agentId.slice(1) + ' ' + status + ' on task #' + taskId,
        body: error.message.substring(0, 500),
        action_type: 'view_run',
        action_data: JSON.stringify({ run_id: runId, task_id: taskId })
      });
      bus.emit('notification:created', {
        id: Number(failNotifResult.lastInsertRowid),
        agent_id: agentId, task_id: taskId, type: status === 'timeout' ? 'warning' : 'error',
        title: agentId.charAt(0).toUpperCase() + agentId.slice(1) + ' ' + status + ' on task #' + taskId
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

// Workspace path for briefs, audits, portfolio, memory
const WORKSPACE = path.join(process.env.HOME || '/Users/joshuasack', '.openclaw', 'workspace');

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
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache, no-store, must-revalidate' });
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
          // INTEL-04: Include last run cost
          const costRow = stmts.getLastRunCost.get(cfg.id);
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
            last_run_summary: run && run.result_text ? run.result_text.substring(0, 120) : null,
            last_run_cost: costRow ? costRow.estimated_cost_usd : null
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

        // INTEL-02: Jarvis auto-routing when no agent specified or explicit auto_route
        let routing = null;
        if (!agentId) {
          routing = routeToAgent(message);
          agentId = routing.agent_id;
        } else if (body.auto_route === true && agentId === 'jarvis') {
          routing = routeToAgent(message);
          agentId = routing.agent_id;
        }

        // Validate agent_id against allowlist (T-03-01 mitigation)
        if (validAgentIds.indexOf(agentId) === -1) {
          res.json({ error: 'Unknown agent: ' + agentId + '. Valid agents: ' + validAgentIds.join(', ') }, 400);
          return;
        }

        const runId = dispatchAgent(taskId, agentId, message);
        res.json({ run_id: runId, agent_id: agentId, task_id: taskId, routed: !!routing, routing: routing || null }, 202);
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

      // GET /api/notifications
      if (method === 'GET' && pathname === '/api/notifications') {
        const limitParam = parseInt(url.searchParams.get('limit'), 10);
        const limit = (!isNaN(limitParam) && limitParam > 0) ? Math.min(limitParam, 200) : 50;
        const notifications = stmts.getNotifications.all(limit);
        const unread = stmts.getUnreadCount.get();
        res.json({ notifications, unread_count: unread.count });
        return;
      }

      // PATCH /api/notifications/:id -- read/dismiss/escalate actions
      if (method === 'PATCH' && pathname.startsWith('/api/notifications/')) {
        const id = parseInt(pathname.split('/')[3], 10);
        if (isNaN(id)) { res.json({ error: 'Invalid notification id' }, 400); return; }
        const notif = stmts.getNotificationById.get(id);
        if (!notif) { res.json({ error: 'Notification not found' }, 404); return; }
        const body = await readBody(req);
        if (!body) { res.json({ error: 'Request body required' }, 400); return; }
        const validActions = ['read', 'dismiss', 'escalate'];
        if (!body.action || validActions.indexOf(body.action) === -1) {
          res.json({ error: 'Invalid action. Must be: ' + validActions.join(', ') }, 400);
          return;
        }
        if (body.action === 'read') {
          stmts.markNotificationRead.run(id);
        } else if (body.action === 'dismiss') {
          stmts.dismissNotification.run(id);
        } else if (body.action === 'escalate') {
          stmts.markNotificationRead.run(id);
          stmts.insertActivity.run({
            event_type: 'notification.escalated', agent_id: null, task_id: null,
            project_id: null, summary: 'Escalated: ' + notif.title,
            detail_json: JSON.stringify({ notification_id: id })
          });
          bus.emit('activity:new', { event_type: 'notification.escalated', summary: 'Escalated: ' + notif.title });
        }
        bus.emit('notification:updated', { id, action: body.action });
        res.json({ ok: true });
        return;
      }

      // GET /api/crons -- cron schedule from OpenClaw CLI
      if (method === 'GET' && pathname === '/api/crons') {
        execFile('openclaw', ['cron', 'list', '--json'], {
          timeout: 10000,
          env: { ...process.env, PATH: process.env.PATH + ':/opt/homebrew/bin:/usr/local/bin' }
        }, (error, stdout) => {
          if (error) {
            res.json({ crons: [
              { name: 'Morning Brief', agent: 'scout', schedule: '0 6 * * *', description: 'Daily intelligence brief' },
              { name: 'Daily Build', agent: 'forge', schedule: '0 9 * * 1-5', description: 'Automated build check' },
              { name: 'Security Audit AM', agent: 'sentinel', schedule: '0 8 * * *', description: 'Morning security scan' },
              { name: 'Security Audit PM', agent: 'sentinel', schedule: '0 16 * * *', description: 'Afternoon security scan' },
              { name: 'Wiki Reindex', agent: 'analyst', schedule: '0 2 * * *', description: 'Karpathy memory wiki reindex' },
              { name: 'LinkedIn AM', agent: 'hunter', schedule: '0 7 * * 1-5', description: 'Morning LinkedIn scan' },
              { name: 'LinkedIn PM', agent: 'hunter', schedule: '0 14 * * 1-5', description: 'Afternoon LinkedIn scan' }
            ], source: 'fallback' });
          } else {
            try {
              const cleaned = cleanCliOutput(stdout);
              const parsed = JSON.parse(cleaned);
              res.json({ crons: parsed.crons || parsed, source: 'live' });
            } catch {
              res.json({ crons: [], source: 'error', error: 'Failed to parse cron output' });
            }
          }
        });
        return;
      }

      // GET /api/briefs -- list Scout daily briefs
      if (method === 'GET' && pathname === '/api/briefs') {
        try {
          const docsDir = path.join(WORKSPACE, 'docs');
          const files = fs.readdirSync(docsDir).filter(f => f.startsWith('daily-brief-') && f.endsWith('.md'));
          files.sort().reverse();
          res.json({ briefs: files.map(f => ({ filename: f, date: f.replace('daily-brief-', '').replace('.md', '') })) });
        } catch { res.json({ briefs: [] }); }
        return;
      }

      // GET /api/briefs/:filename -- read a specific brief
      if (method === 'GET' && pathname.startsWith('/api/briefs/') && pathname.split('/').length === 4) {
        const filename = pathname.split('/')[3];
        if (!/^[a-zA-Z0-9._-]+\.md$/.test(filename)) { res.json({ error: 'Invalid filename' }, 400); return; }
        try {
          const content = fs.readFileSync(path.join(WORKSPACE, 'docs', filename), 'utf8');
          res.json({ filename, content });
        } catch { res.json({ error: 'File not found' }, 404); }
        return;
      }

      // GET /api/audits -- list Sentinel audit files
      if (method === 'GET' && pathname === '/api/audits') {
        try {
          const auditDir = path.join(WORKSPACE, 'docs', 'audits');
          const files = fs.readdirSync(auditDir).filter(f => f.endsWith('.md'));
          files.sort().reverse();
          res.json({ audits: files.map(f => ({ filename: f })) });
        } catch { res.json({ audits: [] }); }
        return;
      }

      // GET /api/audits/:filename -- read a specific audit
      if (method === 'GET' && pathname.startsWith('/api/audits/') && pathname.split('/').length === 4) {
        const filename = pathname.split('/')[3];
        if (!/^[a-zA-Z0-9._-]+\.md$/.test(filename)) { res.json({ error: 'Invalid filename' }, 400); return; }
        try {
          const content = fs.readFileSync(path.join(WORKSPACE, 'docs', 'audits', filename), 'utf8');
          res.json({ filename, content });
        } catch { res.json({ error: 'File not found' }, 404); }
        return;
      }

      // GET /api/portfolio -- list Broker portfolio files
      if (method === 'GET' && pathname === '/api/portfolio') {
        try {
          const portfolioDir = path.join(WORKSPACE, 'docs', 'portfolio');
          const files = fs.readdirSync(portfolioDir).filter(f => f.endsWith('.md'));
          files.sort().reverse();
          res.json({ portfolio: files.map(f => ({ filename: f })) });
        } catch { res.json({ portfolio: [] }); }
        return;
      }

      // GET /api/portfolio/:filename -- read a specific portfolio report
      if (method === 'GET' && pathname.startsWith('/api/portfolio/') && pathname.split('/').length === 4) {
        const filename = pathname.split('/')[3];
        if (!/^[a-zA-Z0-9._-]+\.md$/.test(filename)) { res.json({ error: 'Invalid filename' }, 400); return; }
        try {
          const content = fs.readFileSync(path.join(WORKSPACE, 'docs', 'portfolio', filename), 'utf8');
          res.json({ filename, content });
        } catch { res.json({ error: 'File not found' }, 404); }
        return;
      }

      // GET /api/memory/search -- Karpathy wiki search
      if (method === 'GET' && pathname === '/api/memory/search') {
        const query = url.searchParams.get('q');
        if (!query || !query.trim()) { res.json({ error: 'Query parameter q is required' }, 400); return; }
        const scriptPath = path.join(WORKSPACE, 'scripts', 'karpathy-memory.py');
        execFile('python3', [scriptPath, 'search', query.trim()], {
          timeout: 15000,
          maxBuffer: 5 * 1024 * 1024
        }, (error, stdout) => {
          if (error) {
            res.json({ results: [], error: error.message });
          } else {
            try {
              const results = JSON.parse(stdout.trim());
              res.json({ results: Array.isArray(results) ? results : [] });
            } catch {
              const lines = stdout.trim().split('\n').filter(Boolean);
              res.json({ results: lines.map((line, i) => ({ id: i, text: line })) });
            }
          }
        });
        return;
      }

      // GET /api/memory -- list memory files
      if (method === 'GET' && pathname === '/api/memory') {
        try {
          const memDir = path.join(WORKSPACE, 'memory');
          let files = [];
          try { files = fs.readdirSync(memDir).filter(f => f.endsWith('.md')); } catch {}
          let hasTopLevel = false;
          try { fs.accessSync(path.join(WORKSPACE, 'MEMORY.md')); hasTopLevel = true; } catch {}
          res.json({ files, has_memory_md: hasTopLevel });
        } catch { res.json({ files: [], has_memory_md: false }); }
        return;
      }

      // GET /api/memory/:filename -- read a specific memory file
      if (method === 'GET' && pathname.startsWith('/api/memory/') && pathname !== '/api/memory/search') {
        const filename = pathname.split('/').slice(3).join('/');
        if (!/^[a-zA-Z0-9._-]+\.md$/.test(filename)) { res.json({ error: 'Invalid filename' }, 400); return; }
        try {
          let content;
          try {
            content = fs.readFileSync(path.join(WORKSPACE, 'memory', filename), 'utf8');
          } catch {
            content = fs.readFileSync(path.join(WORKSPACE, filename), 'utf8');
          }
          res.json({ filename, content });
        } catch { res.json({ error: 'File not found' }, 404); }
        return;
      }

      // ===== INTEL-01: Interview API =====

      // POST /api/interview/start
      if (method === 'POST' && pathname === '/api/interview/start') {
        const body = await readBody(req);
        let taskContext = '';
        let taskId = null;
        if (body && body.task_id) {
          const task = stmts.getTaskById.get(body.task_id);
          if (task) {
            taskId = task.id;
            taskContext = '\n\nTask to refine:\nTitle: ' + task.title + (task.description ? '\nDescription: ' + task.description : '');
          }
        }

        const systemPrompt = 'You are Jarvis, the chief of staff AI. Interview the user to refine this task. Ask 2-3 clarifying questions about scope, priority, and target outcome. Keep questions short and specific. When you have enough information, summarize the refined task starting with "REFINED TASK:" on its own line, followed by a title on the next line, then the full description.' + taskContext;

        const initialMessages = [{ role: 'system', content: systemPrompt }];
        const result = stmts.insertInterview.run({ task_id: taskId, messages_json: JSON.stringify(initialMessages) });
        const sessionId = Number(result.lastInsertRowid);

        // Call Jarvis for first question
        const cliMessage = systemPrompt + '\n\nPlease ask your first clarifying question about this task.';
        execFile('openclaw', [
          'agent', '--agent', 'jarvis', '--message', cliMessage, '--json', '--timeout', '30'
        ], {
          timeout: 35000, maxBuffer: 5 * 1024 * 1024,
          env: { ...process.env, PATH: process.env.PATH + ':/opt/homebrew/bin:/usr/local/bin' }
        }, (error, stdout) => {
          let responseText = 'What would you like to accomplish with this task? Please describe the goal, scope, and any constraints.';
          if (!error) {
            try {
              const cleaned = cleanCliOutput(stdout);
              const parsed = JSON.parse(cleaned);
              if (parsed.payloads && Array.isArray(parsed.payloads)) {
                responseText = parsed.payloads.map(function (p) { return p.text; }).join('\n');
              } else if (parsed.result) {
                responseText = typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result);
              } else {
                responseText = cleaned;
              }
            } catch {
              responseText = cleanCliOutput(stdout) || responseText;
            }
          }

          const messages = initialMessages.concat([{ role: 'assistant', content: responseText }]);
          stmts.updateInterview.run({
            id: sessionId, messages_json: JSON.stringify(messages),
            refined_title: null, refined_description: null, suggested_agent: null, status: 'active'
          });
          bus.emit('interview:updated', { session_id: sessionId });
          res.json({ session_id: sessionId, messages: [{ role: 'assistant', content: responseText }] });
        });
        return;
      }

      // POST /api/interview/:id/reply
      if (method === 'POST' && /^\/api\/interview\/(\d+)\/reply$/.test(pathname)) {
        const sessionId = parseInt(pathname.match(/^\/api\/interview\/(\d+)\/reply$/)[1], 10);
        const session = stmts.getInterviewById.get(sessionId);
        if (!session) { res.json({ error: 'Interview session not found' }, 404); return; }
        if (session.status !== 'active') { res.json({ error: 'Interview session is ' + session.status }, 400); return; }

        const body = await readBody(req);
        if (!body || !body.message || typeof body.message !== 'string') {
          res.json({ error: 'message is required' }, 400); return;
        }

        // T-05-01: Cap message length
        const userMsg = body.message.substring(0, 2000);
        let messages = JSON.parse(session.messages_json || '[]');

        // T-05-04: Max 20 messages per session
        if (messages.length >= 20) {
          res.json({ error: 'Interview session has reached maximum messages' }, 400); return;
        }

        messages.push({ role: 'user', content: userMsg });

        // Build conversation context for Jarvis
        const convoContext = messages.map(function (m) {
          if (m.role === 'system') return '[System] ' + m.content;
          if (m.role === 'assistant') return '[Jarvis] ' + m.content;
          return '[User] ' + m.content;
        }).join('\n\n');

        execFile('openclaw', [
          'agent', '--agent', 'jarvis', '--message', convoContext, '--json', '--timeout', '30'
        ], {
          timeout: 35000, maxBuffer: 5 * 1024 * 1024,
          env: { ...process.env, PATH: process.env.PATH + ':/opt/homebrew/bin:/usr/local/bin' }
        }, (error, stdout) => {
          let responseText = 'I have enough context. Let me prepare the refined task specification.';
          if (!error) {
            try {
              const cleaned = cleanCliOutput(stdout);
              const parsed = JSON.parse(cleaned);
              if (parsed.payloads && Array.isArray(parsed.payloads)) {
                responseText = parsed.payloads.map(function (p) { return p.text; }).join('\n');
              } else if (parsed.result) {
                responseText = typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result);
              } else {
                responseText = cleaned;
              }
            } catch {
              responseText = cleanCliOutput(stdout) || responseText;
            }
          }

          messages.push({ role: 'assistant', content: responseText });

          // Check if Jarvis indicated task is ready
          let refinedTitle = null;
          let refinedDescription = null;
          let suggestedAgent = null;
          let newStatus = 'active';

          const readyMatch = responseText.match(/(?:TASK READY:|REFINED TASK:)\s*(.*)/is);
          if (readyMatch) {
            const afterMarker = readyMatch[1].trim();
            const lines = afterMarker.split('\n').filter(function (l) { return l.trim(); });
            refinedTitle = (lines[0] || 'Refined Task').replace(/^#+\s*/, '').replace(/^\*+/, '').replace(/\*+$/, '').trim();
            refinedDescription = lines.slice(1).join('\n').trim() || afterMarker;
            const routeResult = routeToAgent(refinedDescription || refinedTitle);
            suggestedAgent = routeResult.agent_id;
            newStatus = 'completed';
          }

          stmts.updateInterview.run({
            id: sessionId, messages_json: JSON.stringify(messages),
            refined_title: refinedTitle, refined_description: refinedDescription,
            suggested_agent: suggestedAgent, status: newStatus
          });
          bus.emit('interview:updated', { session_id: sessionId });

          const responseMessages = messages.filter(function (m) { return m.role !== 'system'; });
          res.json({
            session_id: sessionId, messages: responseMessages, status: newStatus,
            refined_title: refinedTitle, refined_description: refinedDescription,
            suggested_agent: suggestedAgent
          });
        });
        return;
      }

      // POST /api/interview/:id/dispatch
      if (method === 'POST' && /^\/api\/interview\/(\d+)\/dispatch$/.test(pathname)) {
        const sessionId = parseInt(pathname.match(/^\/api\/interview\/(\d+)\/dispatch$/)[1], 10);
        const session = stmts.getInterviewById.get(sessionId);
        if (!session) { res.json({ error: 'Interview session not found' }, 404); return; }

        const body = await readBody(req);
        const agentOverride = body && body.agent_id ? body.agent_id : null;
        const useAgent = agentOverride || session.suggested_agent || 'jarvis';

        if (validAgentIds.indexOf(useAgent) === -1) {
          res.json({ error: 'Unknown agent: ' + useAgent }, 400); return;
        }

        let taskId = session.task_id;
        if (!taskId) {
          // Create a new task from refined interview
          const title = session.refined_title || 'Interview Task';
          const desc = session.refined_description || '';
          const taskResult = stmts.insertTask.run({
            title: title, description: desc, status: 'todo', priority: 'medium',
            agent_id: useAgent, project_id: null, sort_order: 0
          });
          taskId = Number(taskResult.lastInsertRowid);
          const newTask = stmts.getTaskById.get(taskId);
          bus.emit('task:created', newTask);
          bus.emit('activity:new', { event_type: 'task.created', summary: 'Task created from interview: ' + newTask.title, task_id: taskId });
        } else {
          // Update existing task with refined data
          const existing = stmts.getTaskById.get(taskId);
          if (existing) {
            stmts.updateTask.run({
              id: taskId,
              title: session.refined_title || existing.title,
              description: session.refined_description || existing.description,
              status: existing.status, priority: existing.priority,
              agent_id: useAgent, sort_order: existing.sort_order
            });
            bus.emit('task:updated', stmts.getTaskById.get(taskId));
          }
        }

        const message = (session.refined_title || 'Task') + ': ' + (session.refined_description || '');
        const runId = dispatchAgent(taskId, useAgent, message);
        res.json({ run_id: runId, task_id: taskId, agent_id: useAgent }, 202);
        return;
      }

      // GET /api/interview/:id
      if (method === 'GET' && /^\/api\/interview\/(\d+)$/.test(pathname)) {
        const sessionId = parseInt(pathname.match(/^\/api\/interview\/(\d+)$/)[1], 10);
        const session = stmts.getInterviewById.get(sessionId);
        if (!session) { res.json({ error: 'Interview session not found' }, 404); return; }
        let messages = [];
        try { messages = JSON.parse(session.messages_json || '[]'); } catch {}
        const filtered = messages.filter(function (m) { return m.role !== 'system'; });
        res.json({
          session_id: session.id, task_id: session.task_id, status: session.status,
          messages: filtered, refined_title: session.refined_title,
          refined_description: session.refined_description, suggested_agent: session.suggested_agent
        });
        return;
      }

      // ===== INTEL-03: Project CRUD =====

      // GET /api/projects
      if (method === 'GET' && pathname === '/api/projects') {
        const projects = stmts.getAllProjects.all();
        const result = projects.map(function (p) {
          const taskCount = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE project_id = ?').get(p.id);
          const activeCount = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE project_id = ? AND status != 'done'").get(p.id);
          return Object.assign({}, p, {
            task_count: taskCount ? taskCount.count : 0,
            active_task_count: activeCount ? activeCount.count : 0
          });
        });
        res.json({ projects: result });
        return;
      }

      // GET /api/projects/:id
      if (method === 'GET' && /^\/api\/projects\/(\d+)$/.test(pathname)) {
        const projectId = parseInt(pathname.match(/^\/api\/projects\/(\d+)$/)[1], 10);
        const project = stmts.getProjectById.get(projectId);
        if (!project) { res.json({ error: 'Project not found' }, 404); return; }
        const tasks = stmts.getTasksByProject.all(projectId);
        const runs = stmts.getRunsByProject.all(projectId);
        // T-05-03: Safe directory listing for project docs
        let docs = [];
        if (project.slug && /^[a-zA-Z0-9._-]+$/.test(project.slug)) {
          const projectDocsDir = path.join(WORKSPACE, 'projects', project.slug);
          try {
            if (projectDocsDir.startsWith(path.join(WORKSPACE, 'projects'))) {
              docs = fs.readdirSync(projectDocsDir).filter(function (f) { return f.endsWith('.md'); });
            }
          } catch { /* directory doesn't exist */ }
        }
        res.json({ project: project, tasks: tasks, runs: runs, docs: docs });
        return;
      }

      // POST /api/projects
      if (method === 'POST' && pathname === '/api/projects') {
        const body = await readBody(req);
        if (!body || !body.name || typeof body.name !== 'string' || !body.name.trim()) {
          res.json({ error: 'name is required' }, 400); return;
        }
        // T-05-02: Generate slug from name, strip non-alphanumeric
        const slug = body.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        if (!slug) { res.json({ error: 'Invalid project name' }, 400); return; }
        try {
          const result = stmts.insertProject.run({
            name: body.name.trim(), slug: slug,
            description: body.description || null,
            color: body.color || '#00ff41'
          });
          const project = stmts.getProjectById.get(result.lastInsertRowid);
          stmts.insertActivity.run({
            event_type: 'project.created', agent_id: null, task_id: null,
            project_id: project.id, summary: 'Project created: ' + project.name,
            detail_json: JSON.stringify(project)
          });
          bus.emit('activity:new', { event_type: 'project.created', summary: 'Project created: ' + project.name });
          res.json({ project: project }, 201);
        } catch (err) {
          if (err.message && err.message.indexOf('UNIQUE') !== -1) {
            res.json({ error: 'Project slug already exists' }, 409);
          } else {
            throw err;
          }
        }
        return;
      }

      // PATCH /api/projects/:id
      if (method === 'PATCH' && /^\/api\/projects\/(\d+)$/.test(pathname)) {
        const projectId = parseInt(pathname.match(/^\/api\/projects\/(\d+)$/)[1], 10);
        const existing = stmts.getProjectById.get(projectId);
        if (!existing) { res.json({ error: 'Project not found' }, 404); return; }
        const body = await readBody(req);
        if (!body) { res.json({ error: 'Request body required' }, 400); return; }
        stmts.updateProject.run({
          id: projectId,
          name: body.name !== undefined ? body.name : existing.name,
          description: body.description !== undefined ? body.description : existing.description,
          color: body.color !== undefined ? body.color : existing.color,
          status: body.status !== undefined ? body.status : existing.status
        });
        const updated = stmts.getProjectById.get(projectId);
        stmts.insertActivity.run({
          event_type: 'project.updated', agent_id: null, task_id: null,
          project_id: projectId, summary: 'Project updated: ' + updated.name,
          detail_json: JSON.stringify(updated)
        });
        bus.emit('activity:new', { event_type: 'project.updated', summary: 'Project updated: ' + updated.name });
        res.json({ project: updated });
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
