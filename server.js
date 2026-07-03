const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { execFile, execFileSync } = require('node:child_process');
const { db, stmts } = require('./db');
const { bus, handleSSE } = require('./sse');
const runtimes = require('./src/runtimes');
const cookbook = require('./src/cookbook');
const guardrails = require('./src/guardrails');
const deepResearch = require('./src/deep-research');
const scheduler = require('./src/scheduler');
const cleanup = require('./src/cleanup');
const rateLimiter = require('./src/rate-limiter');

// Wire DB statements into the rate limiter so config persists across restarts.
rateLimiter.init(stmts);

// Read HTML file once at startup
const indexHTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const MAX_CHATS = 3;
let activeChats = 0;

// MIME type map
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

// Agent configurations (module-level for dispatch validation + GET /api/agents)
// Agent configurations with runtime routing
// runtime: which CLI to use for dispatch
//   openclaw = openclaw agent --agent <id>
//   claude   = claude -p "<message>" --max-turns 5
//   codex    = codex exec "<message>" --skip-git-repo-check
//   gemini   = gemini -p "<message>"
//   ollama   = ollama run <model> "<message>"
//   hermes   = hermes --yolo chat -q "<message>"
const agentConfigs = [
  { id: 'main',       name: 'Argus',     icon: '\u2699\uFE0F',       role: 'Chief of Staff — orchestration, triage',       model: 'Hermes Agent',       runtime: 'hermes',   color: '#0a84ff' },
  { id: 'scout',      name: 'Scout',      icon: '\uD83D\uDD2D',       role: 'Morning Intelligence — news, signals',         model: 'GPT-5.4-mini',       runtime: 'openclaw', color: '#32ade6' },
  { id: 'analyst',    name: 'Analyst',     icon: '\uD83D\uDD2C',       role: 'Research Deep-Diver — OpenClaw tools',         model: 'GPT-5.4',            runtime: 'openclaw', color: '#5e5ce6' },
  { id: 'forge',      name: 'Forge',      icon: '\uD83D\uDD28',       role: 'Builder — OpenClaw workspace projects',        model: 'GPT-5.4-mini',       runtime: 'openclaw', color: '#ff9f0a' },
  { id: 'sentinel',   name: 'Sentinel',   icon: '\uD83D\uDEE1\uFE0F', role: 'Security Monitor — audits, health',           model: 'llama3.2:3b (local)', runtime: 'openclaw', color: '#ff453a' },
  { id: 'broker',     name: 'Broker',     icon: '\uD83D\uDCC8',       role: 'Investment & Financial Intelligence',           model: 'GPT-5.4-mini',       runtime: 'openclaw', color: '#30d158' },
  { id: 'ops',        name: 'Ops',        icon: '\uD83D\uDDA5\uFE0F', role: 'Infrastructure & DevOps',                      model: 'llama3.2:3b (local)', runtime: 'openclaw', color: '#30b0c7' },
  { id: 'hunter',     name: 'Hunter',     icon: '\uD83C\uDFAF',       role: 'Career & Opportunities',                       model: 'GPT-5.4-mini',       runtime: 'openclaw', color: '#ff375f' },
  { id: 'reviewer',   name: 'Reviewer',   icon: '\uD83D\uDD0D',       role: 'Quality Gate & Review',                        model: 'GPT-5.4',            runtime: 'openclaw', color: '#8e8e93' },
  { id: 'coder',      name: 'Coder',      icon: '\uD83E\uDDD1\u200D\uD83D\uDCBB', role: 'Deep coding — debug, refactor, architecture', model: 'Claude Opus 4.6',  runtime: 'claude',   color: '#a2845e' },
  { id: 'researcher', name: 'Researcher', icon: '\uD83C\uDF10',       role: 'Multi-source research — long context',          model: 'Gemini 2.5 Pro',     runtime: 'gemini',   color: '#00c7be' },
  { id: 'designer',   name: 'Designer',   icon: '\uD83C\uDFA8',       role: 'UI/UX — design systems, visual polish',         model: 'GPT-5.4-mini',       runtime: 'openclaw', color: '#bf5af2' },
  { id: 'hermes',     name: 'Hermes',     icon: '\uD83E\uDDED',       role: 'Persistent orchestrator — overnight build loop', model: 'Hermes Agent',       runtime: 'hermes',   color: '#00c7be' },
];
const agentAliases = { argus: 'main', jarvis: 'main' };
const validAgentIds = agentConfigs.map(a => a.id).concat(['argus', 'jarvis']);
const DEFAULT_SETTINGS = {
  port: Number(process.env.VISIONARY_PORT || 3333),
  workspace_path: process.env.VISIONARY_WORKSPACE || path.join(process.env.HOME || '', '.openclaw', 'workspace'),
  theme: 'dark',
  default_runtime: 'openclaw'
};

function safeJsonParse(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

function getAppSettings() {
  const row = stmts.getSettings.get('app');
  const saved = row ? safeJsonParse(row.value_json, {}) : {};
  return { ...DEFAULT_SETTINGS, ...saved, updated_at: row ? row.updated_at : null };
}

function saveAppSettings(input) {
  const current = getAppSettings();
  const runtimeIds = runtimes.listRuntimeIds();
  const next = {
    port: Number(input.port || current.port || DEFAULT_SETTINGS.port),
    workspace_path: String(input.workspace_path || current.workspace_path || DEFAULT_SETTINGS.workspace_path),
    theme: ['dark', 'light', 'system'].includes(input.theme) ? input.theme : current.theme,
    default_runtime: runtimeIds.includes(input.default_runtime) ? input.default_runtime : current.default_runtime
  };
  if (!Number.isInteger(next.port) || next.port < 1 || next.port > 65535) {
    throw new Error('port must be an integer from 1 to 65535');
  }
  stmts.upsertSettings.run({ key: 'app', value_json: JSON.stringify(next) });
  return getAppSettings();
}

agentConfigs.forEach(function (agent) {
  stmts.upsertAgentRuntime.run({
    id: agent.id,
    name: agent.name,
    runtime: agent.runtime || 'openclaw',
    config_json: JSON.stringify({ model: agent.model, role: agent.role })
  });
});

function resolveAgentConfig(agentId) {
  const canonical = agentAliases[agentId] || agentId;
  const cfg = agentConfigs.find(a => a.id === canonical);
  if (!cfg) return null;
  const dbRuntime = stmts.getAgentRuntime.get(canonical);
  const settings = getAppSettings();
  return {
    ...cfg,
    id: canonical,
    runtime: (dbRuntime && dbRuntime.runtime) || cfg.runtime || settings.default_runtime || 'openclaw'
  };
}

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
  return { agent_id: 'argus', confidence: 'low', matched_keywords: [] };
}

// Track running agent processes for kill switch
// Map<runId, { process, agentId, taskId, startTime }>
const activeDispatches = new Map();

// Crons cache (60s TTL — openclaw cron list takes ~8s)
let cronCache = { data: null, ts: 0 };

// Pre-warm crons cache at startup
execFile('openclaw', ['cron', 'list', '--json'], {
  timeout: 15000,
  env: { ...process.env, PATH: process.env.PATH + ':/opt/homebrew/bin:/usr/local/bin' }
}, (error, stdout) => {
  if (!error && stdout) {
    try {
      const cleaned = cleanCliOutput(stdout);
      const parsed = JSON.parse(cleaned);
      cronCache = { data: { crons: parsed.crons || parsed, source: 'live' }, ts: Date.now() };
    } catch {}
  }
});

// Track active reviews to prevent concurrent review loops
const activeReviews = new Set();
const reviewRetries = new Map();
const MAX_REVIEW_RETRIES = 3;

// Auto-review: run the Reviewer through its failover chain to evaluate
// completed work, with the original run's artifact list as evidence.
async function triggerReview(taskId, runId, originalAgent, resultText) {
  // Prevent concurrent reviews on same task
  if (activeReviews.has(taskId)) return;
  activeReviews.add(taskId);

  const task = stmts.getTaskById.get(taskId);
  if (!task) { activeReviews.delete(taskId); return; }

  // Artifact evidence from the original run so the reviewer judges real
  // deliverables instead of guessing from prose.
  let workdir = null;
  let artifactBlock = 'No files were recorded for this run.';
  try {
    const origRun = stmts.getRunById.get(runId);
    workdir = origRun && origRun.workdir;
    const artifacts = JSON.parse((origRun && origRun.artifacts_json) || '[]');
    if (workdir && artifacts.length) {
      artifactBlock = 'Files produced in ' + workdir + ':\n'
        + artifacts.slice(0, 50).map(function (a) { return '- ' + a.path + ' (' + (a.size || 0) + ' bytes)'; }).join('\n');
    }
  } catch { /* keep default */ }

  const reviewPrompt = 'You are reviewing the output of agent "' + originalAgent + '" on task #' + taskId + ': "' + (task.title || '') + '".\n\n'
    + 'Task description: ' + (task.description || 'None') + '\n\n'
    + artifactBlock + '\n\n'
    + 'Agent report (first 2000 chars):\n' + (resultText || 'No output captured').substring(0, 2000) + '\n\n'
    + 'You may read the produced files to verify them.\n'
    + 'APPROVE when the deliverable does what the task asked, even if imperfect. '
    + 'REJECT only for concrete, fixable defects — name each one specifically.\n'
    + 'The FIRST line of your reply must be exactly one of:\n'
    + 'APPROVE: <one-line summary of what was delivered>\n'
    + 'REJECT: <specific issues that need fixing>';

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

  const env = Object.assign({}, process.env, { PATH: process.env.PATH + ':/opt/homebrew/bin:/usr/local/bin' });
  const startTime = Date.now();
  let result;
  try {
    result = await runtimes.executeWithFailover(
      { getRuntime: runtimes.getRuntime, stmts, db },
      resolveAgentRow('reviewer'),
      // Read-only tools: the reviewer verifies, it does not fix.
      { message: buildAgentPrompt('reviewer', reviewPrompt), agentId: 'reviewer', allowedTools: ['Read', 'Glob', 'Grep'] },
      { timeout: 180000, env, cwd: workdir || __dirname }
    );
  } catch (err) {
    result = { status: 'error', stdout: '', stderr: (err && err.message) || String(err) };
  }
  const durationMs = Date.now() - startTime;
  const output = result.status === 'ok' ? extractResultText(cleanCliOutput(result.stdout || '')) : '';

  if (!output) {
    stmts.completeRun.run({ id: reviewRunId, status: 'failed', result_json: null, result_text: null, error: (result.stderr || result.status || 'unknown').substring(0, 500), duration_ms: durationMs });
    activeReviews.delete(taskId);
    return;
  }

  stmts.completeRun.run({ id: reviewRunId, status: 'completed', result_json: null, result_text: output, error: null, duration_ms: durationMs });

  // First structured verdict line wins — never keyword-anywhere matching,
  // which false-fired on the rubric echoed back in the reply.
  const verdictMatch = output.match(/\b(APPROVE|REJECT)\s*:\s*([^\n]*)/i);
  if (!verdictMatch) {
    // Inconclusive: leave the task in review for the operator instead of churning.
    stmts.insertNotification.run({ agent_run_id: reviewRunId, type: 'warning', title: 'Review inconclusive for task #' + taskId, body: 'Reviewer gave no APPROVE/REJECT verdict — check the run output.', action_type: 'view_task', action_data: JSON.stringify({ task_id: taskId }) });
    bus.emit('activity:new', { event_type: 'review.inconclusive', agent_id: 'reviewer', task_id: taskId, summary: 'Review inconclusive on "' + task.title + '"' });
    activeReviews.delete(taskId);
    return;
  }
  const verdict = verdictMatch[1].toUpperCase();
  const detail = (verdictMatch[2] || '').trim().substring(0, 500);

  if (verdict === 'APPROVE') {
    stmts.updateTask.run({
      id: taskId, title: task.title, description: task.description,
      status: 'done', priority: task.priority,
      agent_id: task.agent_id, sort_order: task.sort_order
    });
    bus.emit('task:updated', stmts.getTaskById.get(taskId));

    const summary = detail || 'Work approved';
    stmts.insertNotification.run({ agent_run_id: reviewRunId, type: 'info', title: 'Reviewer approved task #' + taskId, body: summary, action_type: 'view_task', action_data: JSON.stringify({ task_id: taskId }) });
    stmts.insertActivity.run({ event_type: 'review.approved', agent_id: 'reviewer', task_id: taskId, project_id: task.project_id, summary: 'Approved: ' + task.title + ' — ' + summary, detail_json: null });
    bus.emit('activity:new', { event_type: 'review.approved', agent_id: 'reviewer', task_id: taskId, summary: 'Approved: ' + summary });
    reviewRetries.delete(taskId);
    activeReviews.delete(taskId);
    return;
  }

  // REJECT
  const feedback = detail || 'Quality issues found';
  stmts.insertActivity.run({ event_type: 'review.rejected', agent_id: 'reviewer', task_id: taskId, project_id: task.project_id, summary: 'Rejected: ' + task.title + ' — ' + feedback, detail_json: null });
  bus.emit('activity:new', { event_type: 'review.rejected', agent_id: 'reviewer', task_id: taskId, summary: 'Rejected: ' + feedback });
  activeReviews.delete(taskId);

  const retries = reviewRetries.get(taskId) || 0;
  if (retries >= MAX_REVIEW_RETRIES) {
    // Give up gracefully: leave it in review for the operator, don't loop.
    stmts.insertNotification.run({ agent_run_id: reviewRunId, type: 'error', title: 'Review max retries reached for task #' + taskId, body: 'Task rejected ' + retries + ' times. Latest feedback: ' + feedback + ' — manual intervention needed.', action_type: 'view_task', action_data: JSON.stringify({ task_id: taskId }) });
    reviewRetries.delete(taskId);
    return;
  }
  reviewRetries.set(taskId, retries + 1);

  stmts.insertNotification.run({ agent_run_id: reviewRunId, type: 'warning', title: 'Reviewer rejected task #' + taskId, body: feedback + ' — Redeploying ' + originalAgent + ' (attempt ' + (retries + 1) + '/' + MAX_REVIEW_RETRIES + ')', action_type: 'view_task', action_data: JSON.stringify({ task_id: taskId }) });

  setTimeout(function () {
    const redeployMsg = 'Your previous work on task "' + task.title + '" was reviewed and rejected. Feedback: ' + feedback
      + '\n\nOriginal task: ' + (task.description || task.title)
      + '\n\nThis is attempt ' + (retries + 1) + ' of ' + MAX_REVIEW_RETRIES + '. Please fix the issues and redo the work.';
    bus.emit('activity:new', { event_type: 'agent.redeployed', agent_id: originalAgent, task_id: taskId, summary: originalAgent + ' redeployed on "' + task.title + '" after review rejection' });
    // dispatchAgent reuses the workdir/failover/artifact machinery and its
    // completion path re-enters triggerReview for the next round.
    dispatchAgent(taskId, originalAgent, redeployMsg);
  }, 2000);
}

// Inter-agent messaging: agents can leave messages for each other via the activity_log
// Agents read messages by querying GET /api/messages?to=<agent_id>
function postAgentMessage(fromAgent, toAgent, subject, body, taskId) {
  stmts.insertActivity.run({
    event_type: 'agent.message',
    agent_id: fromAgent,
    task_id: taskId || null,
    project_id: null,
    summary: '[' + fromAgent + ' → ' + toAgent + '] ' + subject,
    detail_json: JSON.stringify({ from: fromAgent, to: toAgent, subject, body })
  });
  bus.emit('activity:new', {
    event_type: 'agent.message', agent_id: fromAgent, task_id: taskId,
    summary: '[' + fromAgent + ' → ' + toAgent + '] ' + subject
  });
  bridgePublishMessage(fromAgent, toAgent, subject, body, taskId);
}

// Bridge integration: route inter-agent messages through the Python bridge
const BRIDGE_HTTP = 'http://127.0.0.1:3335';
let bridgeProcess = null;

// Fire-and-forget POST to the local bridge. Swallows errors — bridge may not be running.
function bridgePost(endpoint, payload) {
  const data = JSON.stringify(payload);
  const req = http.request(`${BRIDGE_HTTP}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    timeout: 2000
  }, () => {});
  req.on('error', () => {});
  req.write(data);
  req.end();
}

function bridgePublishMessage(fromAgent, toAgent, subject, body, taskId) {
  bridgePost('/message', {
    from: fromAgent, to: toAgent, subject: subject, body: body || '', task_id: taskId || null
  });
}

function bridgePublish(topic, payload, fromAgent) {
  bridgePost('/publish', { topic, payload, from: fromAgent || 'node-server' });
}

function spawnBridge() {
  const bridgePath = path.join(__dirname, 'bridge.py');
  if (!fs.existsSync(bridgePath)) return;
  const pythonBin = fs.existsSync(path.join(__dirname, '.venv', 'bin', 'python3'))
    ? path.join(__dirname, '.venv', 'bin', 'python3')
    : 'python3';
  bridgeProcess = execFile(pythonBin, [bridgePath], {
    cwd: __dirname,
    timeout: 0,
    env: { ...process.env, VISIONARY_DB: path.join(__dirname, 'visionary.sqlite') }
  }, (err) => {
    if (err && err.code !== 1 && err.signal !== 'SIGTERM') {
      console.error('[bridge] exited:', err.message);
    }
  });
  bridgeProcess.stdout.on('data', (d) => process.stdout.write('[bridge] ' + d.toString()));
  bridgeProcess.stderr.on('data', (d) => process.stderr.write('[bridge] ' + d.toString()));
  console.log('[server] Agent bridge spawned (pid ' + bridgeProcess.pid + ')');
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

// Older agent_runs rows stored the raw OpenClaw JSON envelope in result_text.
// Extract the human text before any truncation so previews stay readable.
function extractResultText(raw) {
  const text = String(raw || '').trim();
  if (text.charAt(0) !== '{' && text.charAt(0) !== '[') return text;
  try {
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.payloads)) {
      return parsed.payloads.map(p => (p && p.text) || '').join('\n').trim() || text;
    }
    if (parsed && parsed.result) {
      return typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result);
    }
  } catch { /* not JSON — fall through */ }
  return text;
}

function cap(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }

// Agent personality / charter injection. Each dispatch is prefixed with the
// agent's charter so it behaves per its role instead of as a blank assistant.
const PERSONALITY_DIR = path.join(__dirname, 'personalities', 'agents');
const personalityCache = new Map();
const PERSONALITY_MAX_CHARS = 6000;
function loadPersonality(agentId) {
  const fileId = (agentId === 'main' || agentId === 'jarvis') ? 'argus' : agentId;
  if (personalityCache.has(fileId)) return personalityCache.get(fileId);
  let text = '';
  try {
    const p = path.join(PERSONALITY_DIR, fileId + '.md');
    if (fs.existsSync(p)) {
      text = fs.readFileSync(p, 'utf8');
      if (text.length > PERSONALITY_MAX_CHARS) text = text.slice(0, PERSONALITY_MAX_CHARS) + '\n…[charter truncated]';
    }
  } catch { text = ''; }
  personalityCache.set(fileId, text);
  return text;
}
function buildAgentPrompt(agentId, message, workdir) {
  const cfg = resolveAgentConfig(agentId);
  const persona = loadPersonality(agentId);
  const workdirNote = workdir
    ? '\n\n[WORKSPACE]\nYour working directory is ' + workdir + ' (you start inside it). Save every deliverable — files, reports, code — inside this directory using absolute paths. End your reply with a short list of the files you produced.'
    : '';
  if (!persona) return message + workdirNote;
  const name = (cfg && cfg.name) || agentId;
  const role = (cfg && cfg.role) || '';
  return '[SYSTEM — you are ' + name + (role ? ', ' + role : '') + '. Operate per your charter below.]\n'
    + persona.trim() + workdirNote + '\n\n[TASK]\n' + message;
}

// Task artifact workspace: every dispatch runs inside ~/Visionary/<project>/task-<id>
// so the operator can always find what an agent produced.
const ARTIFACT_ROOT = process.env.VISIONARY_ARTIFACTS || path.join(process.env.HOME || '', 'Visionary');
function slugify(name) {
  return String(name || 'inbox').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'inbox';
}
function prepareWorkdir(taskId) {
  const task = stmts.getTaskById.get(taskId);
  const projectName = task && task.project_name ? task.project_name : 'inbox';
  const dir = path.join(ARTIFACT_ROOT, slugify(projectName), 'task-' + taskId);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { return null; }
  return dir;
}
function collectArtifacts(workdir, sinceMs) {
  const files = [];
  function walk(dir, depth) {
    if (depth > 6 || files.length >= 500) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(full, depth + 1); continue; }
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      files.push({
        path: path.relative(workdir, full),
        size: st.size,
        modified_at: st.mtime.toISOString(),
        new: st.mtimeMs >= sinceMs
      });
    }
  }
  if (workdir) walk(workdir, 0);
  return files;
}

// Resolve the org-chart row that owns this agent's harness_chain (for failover +
// conversation history + health bookkeeping). Falls back to a synthesized row
// built from the flat agent config so dispatch always has at least one harness.
function resolveAgentRow(agentId) {
  const tableId = (agentId === 'main' || agentId === 'jarvis') ? 'argus' : agentId;
  let row = null;
  try { row = stmts.getAgentById.get(tableId); } catch { row = null; }
  if (row && row.harness_chain) return row;
  const cfg = resolveAgentConfig(agentId);
  const runtime = (cfg && cfg.runtime) || 'openclaw';
  return {
    id: (row && row.id) || (cfg && cfg.id) || agentId,
    name: (cfg && cfg.name) || agentId,
    harness_chain: JSON.stringify([runtime]),
    current_harness: (row && row.current_harness) || runtime
  };
}

// Dispatch an agent through the full failover chain, streaming output over SSE.
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

  // Resolve the org-chart row (harness chain + bookkeeping) and display config.
  const agentRow = resolveAgentRow(agentId);
  const cfg = resolveAgentConfig(agentId);
  const workdir = prepareWorkdir(taskId);
  if (workdir) stmts.setRunWorkdir.run({ id: runId, workdir });
  const ctx = {
    message: buildAgentPrompt(agentId, message, workdir),
    agentId: cfg ? cfg.id : agentId,
    model: cfg && cfg.model,
    agent: cfg,
    // Trusted local automation: let headless claude actually use its tools
    // instead of blocking on permission prompts. Adapters that don't support
    // this flag simply ignore it.
    dangerouslySkipPermissions: true
  };

  // Track the run before dispatch so the kill switch can find + terminate the
  // live child (the child is supplied via the onChild hook below).
  activeDispatches.set(runId, { process: null, agentId, taskId, startTime, cancelled: false });

  const env = { ...process.env, PATH: process.env.PATH + ':/opt/homebrew/bin:/usr/local/bin' };
  const failoverOpts = {
    timeout: 660000,
    env,
    cwd: workdir || __dirname,
    onChunk: function (harness, chunk, stream) {
      bus.emit('agent:output', { run_id: runId, agent_id: agentId, task_id: taskId, harness, stream, chunk });
    },
    onHarnessStart: function (harness, idx, total) {
      stmts.insertActivity.run({
        event_type: 'dispatch.runtime', agent_id: agentId, task_id: taskId,
        project_id: null, summary: agentId + ' dispatching via ' + harness + ' (' + (idx + 1) + '/' + total + ')',
        detail_json: JSON.stringify({ harness, attempt: idx + 1, total })
      });
      bus.emit('agent:harness', { run_id: runId, agent_id: agentId, task_id: taskId, harness, attempt: idx + 1, total });
    },
    onChild: function (child) {
      const inf = activeDispatches.get(runId);
      if (inf) inf.process = child;
    },
    isCancelled: function () {
      const inf = activeDispatches.get(runId);
      return !!(inf && inf.cancelled);
    }
  };

  runtimes.executeWithFailover(
    { getRuntime: runtimes.getRuntime, stmts, db },
    agentRow, ctx, failoverOpts
  ).then(function (result) {
    finishDispatch(runId, agentId, taskId, startTime, result);
  }).catch(function (err) {
    finishDispatch(runId, agentId, taskId, startTime, {
      status: 'error', harness: null, stdout: '', stderr: (err && err.message) || String(err)
    });
  });

  return runId;
}

// Apply terminal run state + side effects after a (possibly multi-harness)
// dispatch settles. Split out of dispatchAgent so the streaming failover call
// reads cleanly.
function finishDispatch(runId, agentId, taskId, startTime, result) {
  const durationMs = Date.now() - startTime;
  const info = activeDispatches.get(runId);

  // Cancelled by the kill switch — that route already finalized the run row and
  // emitted events; don't double-apply completion state.
  if (result.status === 'cancelled' || (info && info.cancelled)) {
    activeDispatches.delete(runId);
    return;
  }

  if (result.status === 'ok') {
    const cleaned = cleanCliOutput(result.stdout || '');
    let resultText = cleaned;
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed.payloads && Array.isArray(parsed.payloads)) {
        resultText = parsed.payloads.map(p => p.text).join('\n');
      } else if (parsed.result) {
        resultText = typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result);
      }
    } catch { /* not JSON -- use cleaned stdout */ }

    stmts.completeRun.run({
      id: runId, status: 'completed', result_json: cleaned,
      result_text: resultText, error: null, duration_ms: durationMs
    });

    // Record what the run produced so the operator can find + open it from the UI.
    let artifacts = [];
    let runWorkdir = null;
    try {
      const runRow = stmts.getRunById.get(runId);
      runWorkdir = runRow && runRow.workdir;
      if (runWorkdir) {
        artifacts = collectArtifacts(runWorkdir, startTime);
        stmts.setRunArtifacts.run({ id: runId, artifacts_json: JSON.stringify(artifacts) });
      }
    } catch { /* artifact scan must never fail the run */ }

    // INTEL-04: parse token usage from CLI JSON output and estimate cost
    try {
      const parsed = JSON.parse(cleaned);
      const usage = parsed.usage || parsed.token_usage || (parsed.metrics && parsed.metrics);
      if (usage && (usage.input_tokens || usage.output_tokens)) {
        const inputTok = usage.input_tokens || 0;
        const outputTok = usage.output_tokens || 0;
        const agentCfg = agentConfigs.find(function (c) { return c.id === agentId; });
        const isLlama = agentCfg && agentCfg.model && agentCfg.model.indexOf('llama') !== -1;
        // Prefer the harness's own cost figure (claude --output-format json
        // emits total_cost_usd); fall back to a rough per-token estimate.
        const cost = typeof parsed.total_cost_usd === 'number'
          ? parsed.total_cost_usd
          : isLlama
            ? (inputTok * 0.0001 + outputTok * 0.0001) / 1000
            : (inputTok * 0.003 + outputTok * 0.015) / 1000;
        stmts.updateRunTokens.run({ id: runId, input_tokens: inputTok, output_tokens: outputTok, estimated_cost_usd: cost });
      }
    } catch (_tokenErr) { /* no usage data */ }

    const harnessLabel = result.harness ? ' via ' + result.harness : '';

    const artifactNote = runWorkdir
      ? '\n\n' + artifacts.filter(a => a.new).length + ' file(s) produced in ' + runWorkdir
      : '';
    const notifResult = stmts.insertNotification.run({
      agent_run_id: runId, type: 'info',
      title: cap(agentId) + ' completed task #' + taskId,
      body: (resultText ? resultText.substring(0, 500) : 'No output') + artifactNote,
      action_type: 'view_run', action_data: JSON.stringify({ run_id: runId, task_id: taskId, workdir: runWorkdir })
    });
    bus.emit('notification:created', {
      id: Number(notifResult.lastInsertRowid), agent_id: agentId, task_id: taskId,
      type: 'info', title: cap(agentId) + ' completed task #' + taskId
    });

    const currentTask = stmts.getTaskById.get(taskId);
    if (currentTask) {
      stmts.updateTask.run({
        id: taskId, title: currentTask.title, description: currentTask.description,
        status: 'review', priority: currentTask.priority,
        agent_id: currentTask.agent_id, sort_order: currentTask.sort_order
      });
      bus.emit('task:updated', stmts.getTaskById.get(taskId));
    }

    stmts.insertActivity.run({
      event_type: 'agent.completed', agent_id: agentId, task_id: taskId,
      project_id: null, summary: agentId + ' completed task #' + taskId + harnessLabel + ' (' + Math.round(durationMs / 1000) + 's)',
      detail_json: JSON.stringify({ run_id: runId, harness: result.harness, attempts: result.attempts, replayed: result.replayed, duration_ms: durationMs })
    });

    bus.emit('agent:completed', {
      run_id: runId, agent_id: agentId, task_id: taskId, harness: result.harness,
      duration_ms: durationMs, result_text: resultText ? resultText.substring(0, 200) : '',
      workdir: runWorkdir, artifact_count: artifacts.length,
      new_artifact_count: artifacts.filter(a => a.new).length
    });

    if (agentId !== 'reviewer') {
      triggerReview(taskId, runId, agentId, resultText).catch(function (err) {
        console.error('[review] failed for task #' + taskId + ':', (err && err.message) || err);
        activeReviews.delete(taskId);
      });
    }
    bus.emit('activity:new', {
      event_type: 'agent.completed', agent_id: agentId, task_id: taskId,
      summary: agentId + ' completed task #' + taskId + harnessLabel + ' (' + Math.round(durationMs / 1000) + 's)'
    });
  } else {
    // Failure: all-exhausted / rate-limited / error.
    const status = 'failed';
    const errMsg = (result.stderr && String(result.stderr).slice(0, 1000))
      || ('All harnesses exhausted (' + result.status + ')');
    stmts.completeRun.run({
      id: runId, status, result_json: null, result_text: null,
      error: errMsg, duration_ms: durationMs
    });

    const failNotifResult = stmts.insertNotification.run({
      agent_run_id: runId, type: 'error',
      title: cap(agentId) + ' ' + status + ' on task #' + taskId,
      body: errMsg.substring(0, 500),
      action_type: 'view_run', action_data: JSON.stringify({ run_id: runId, task_id: taskId })
    });
    bus.emit('notification:created', {
      id: Number(failNotifResult.lastInsertRowid), agent_id: agentId, task_id: taskId,
      type: 'error', title: cap(agentId) + ' ' + status + ' on task #' + taskId
    });

    const failedTask = stmts.getTaskById.get(taskId);
    if (failedTask && failedTask.status === 'in_progress') {
      stmts.updateTask.run({
        id: taskId, title: failedTask.title, description: failedTask.description,
        status: 'todo', priority: failedTask.priority,
        agent_id: failedTask.agent_id, sort_order: failedTask.sort_order
      });
      bus.emit('task:updated', stmts.getTaskById.get(taskId));
    }

    const errSummary = agentId + ' ' + status + ' on task #' + taskId + ': ' + errMsg.substring(0, 100);
    stmts.insertActivity.run({
      event_type: 'agent.' + status, agent_id: agentId, task_id: taskId,
      project_id: null, summary: errSummary,
      detail_json: JSON.stringify({ run_id: runId, error: errMsg, attempts: result.attempts, duration_ms: durationMs })
    });
    bus.emit('agent:failed', { run_id: runId, agent_id: agentId, task_id: taskId, error: errMsg, duration_ms: durationMs });
    bus.emit('activity:new', { event_type: 'agent.' + status, agent_id: agentId, task_id: taskId, summary: errSummary });
  }

  activeDispatches.delete(runId);
}

// Helper: read request body and JSON.parse it
const MAX_BODY_BYTES = 65536;
function readBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
    req.on('aborted', () => resolve(null));
  });
}

// Workspace path for briefs, audits, portfolio, memory.
// Override with VISIONARY_WORKSPACE; defaults to ~/.openclaw/workspace.
const WORKSPACE = process.env.VISIONARY_WORKSPACE
  || path.join(process.env.HOME || process.env.USERPROFILE || '.', '.openclaw', 'workspace');

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


function readTextIfExists(filePath, maxChars = 4000) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const text = fs.readFileSync(filePath, 'utf8');
    return text.length > maxChars ? text.slice(-maxChars) : text;
  } catch (err) {
    return 'read error: ' + err.message;
  }
}

function getOrchestratorStatus() {
  const root = __dirname;
  const orchDir = path.join(root, '.orchestration');
  const workerRoot = path.join(path.dirname(root), '_visionary_agents');
  const lanes = ['hardening', 'packaging', 'qa-security'];
  const workers = lanes.map(function (lane) {
    const statusText = (readTextIfExists(path.join(orchDir, 'status', lane + '.status'), 200) || 'unknown').trim();
    const logTail = readTextIfExists(path.join(orchDir, 'logs', lane + '.log'), 2000) || '';
    let tmux = 'unknown';
    try {
      execFileSync('tmux', ['has-session', '-t', 'visionary-' + lane], { stdio: 'ignore' });
      tmux = 'running';
    } catch {
      tmux = 'not-running';
    }
    let diffStat = '';
    try {
      diffStat = execFileSync('git', ['diff', '--stat'], {
        cwd: path.join(workerRoot, lane), timeout: 2000, encoding: 'utf8'
      }).trim();
    } catch (err) {
      diffStat = 'diff unavailable: ' + err.message;
    }
    return { lane, status: statusText, tmux, log_tail: logTail.split('\n').slice(-8).join('\n'), diff_stat: diffStat };
  });

  let cron = { job_id: '7559594abe69', schedule: 'every 30m', state: 'scheduled' };
  try {
    const output = execFileSync('hermes', ['cron', 'list'], { timeout: 5000, encoding: 'utf8' });
    cron.raw = output.slice(0, 2000);
    if (/Gateway is not running/i.test(output)) cron.state = 'gateway-off';
    else if (/\[active\]/i.test(output)) cron.state = 'active';
  } catch (err) {
    cron.error = err.message;
  }

  let gateway = { running: false, status: 'unknown' };
  try {
    const output = execFileSync('hermes', ['gateway', 'status'], { timeout: 5000, encoding: 'utf8' });
    gateway.raw = output.slice(0, 1500);
    gateway.running = /Gateway service is loaded|Gateway is running|PID\s*=|\"PID\"\s*=/.test(output);
    const pidMatch = output.match(/\"PID\"\s*=\s*(\d+)|PID:\s*(\d+)/);
    if (pidMatch) gateway.pid = Number(pidMatch[1] || pidMatch[2]);
    gateway.status = gateway.running ? 'running' : 'stopped';
  } catch (err) {
    gateway.status = 'error';
    gateway.error = err.message;
  }

  let harnesses = { claude: 'unknown', opencode: 'unknown', cursor: 'unknown' };
  try { harnesses.claude = execFileSync('claude', ['--version'], { timeout: 2000, encoding: 'utf8' }).trim(); } catch (err) { harnesses.claude = 'error: ' + err.message; }
  try { harnesses.opencode = execFileSync('opencode', ['auth', 'list'], { timeout: 3000, encoding: 'utf8' }).trim().slice(0, 300) || 'no credentials output'; } catch (err) { harnesses.opencode = 'error: ' + err.message; }
  try { harnesses.cursor = execFileSync('agent', ['models'], { timeout: 3000, encoding: 'utf8' }).trim().slice(0, 300) || 'no models output'; } catch (err) { harnesses.cursor = 'error: ' + err.message; }

  return {
    role: 'Hermes persistent orchestrator',
    live: true,
    cron,
    gateway,
    workers,
    harnesses,
    plan_path: path.join(orchDir, 'PRODUCTION_READY_BY_TOMORROW.md'),
    watchdog_path: path.join(orchDir, 'watchdog-status.sh'),
    updated_at: new Date().toISOString()
  };
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
      // GET /api/overview — one-glance mission control snapshot
      if (method === 'GET' && pathname === '/api/overview') {
        const taskCounts = db.prepare('SELECT status, COUNT(*) AS count FROM tasks GROUP BY status').all();
        const priorityCounts = db.prepare('SELECT priority, COUNT(*) AS count FROM tasks GROUP BY priority').all();
        const runCounts = db.prepare('SELECT status, COUNT(*) AS count FROM agent_runs GROUP BY status').all();
        const projectCounts = db.prepare('SELECT status, COUNT(*) AS count FROM projects GROUP BY status').all();
        const openTasks = db.prepare(`
          SELECT t.*, p.name AS project_name, p.color AS project_color
          FROM tasks t LEFT JOIN projects p ON t.project_id = p.id
          WHERE t.status != 'done'
          ORDER BY CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, t.updated_at DESC
          LIMIT 8
        `).all();
        const staleRunningRuns = db.prepare(`
          SELECT ar.*, t.title AS task_title
          FROM agent_runs ar LEFT JOIN tasks t ON ar.task_id = t.id
          WHERE ar.status = 'running' AND datetime(ar.started_at) < datetime('now', '-2 hours')
          ORDER BY ar.started_at ASC
          LIMIT 8
        `).all();
        const recentRuns = db.prepare(`
          SELECT ar.*, t.title AS task_title
          FROM agent_runs ar LEFT JOIN tasks t ON ar.task_id = t.id
          ORDER BY ar.created_at DESC
          LIMIT 6
        `).all();
        const recentActivity = stmts.getRecentActivity.all(6);
        const unread = stmts.getUnreadCount.get();
        const latestByAgent = stmts.getLatestRunPerAgent.all();
        const activeAgentIds = Array.from(activeDispatches.values()).map(function (d) { return d.agentId; });

        const missions = [];
        if (staleRunningRuns.length) {
          missions.push({
            rank: missions.length + 1,
            type: 'system_hygiene',
            priority: 'critical',
            title: 'Clean stale agent run rows',
            detail: staleRunningRuns.length + ' run(s) have been marked running for more than 2 hours while no live dispatch is attached.',
            action_label: 'Clean stale runs',
            action_type: 'clean_stale_runs',
            target: '#/overview',
            score: 100
          });
        }
        openTasks.slice(0, 3).forEach(function (task) {
          const priorityScore = { critical: 90, high: 75, medium: 55, low: 35 }[task.priority] || 45;
          missions.push({
            rank: missions.length + 1,
            type: 'task',
            priority: task.priority || 'medium',
            title: task.title,
            detail: (task.project_name || 'No project') + ' · ' + (task.agent_id || 'unassigned') + ' · ' + task.status,
            action_label: task.agent_id ? 'Dispatch ' + task.agent_id : 'Open board',
            action_type: task.agent_id ? 'dispatch_task' : 'open_board',
            task_id: task.id,
            agent_id: task.agent_id,
            target: '#/board',
            score: priorityScore
          });
        });
        const unreadCount = unread ? unread.count : 0;
        if (unreadCount > 0) {
          missions.push({
            rank: missions.length + 1,
            type: 'inbox',
            priority: unreadCount > 50 ? 'high' : 'medium',
            title: 'Triage notification backlog',
            detail: unreadCount + ' unread notification(s) are waiting for review.',
            action_label: 'Open inbox',
            action_type: 'open_inbox',
            target: '#/inbox',
            score: unreadCount > 50 ? 70 : 45
          });
        }
        if (!missions.length) {
          missions.push({
            rank: 1,
            type: 'strategy',
            priority: 'medium',
            title: 'Choose the next build mission',
            detail: 'No urgent dashboard work is open. Use Cmd+K to create or auto-route the next mission.',
            action_label: 'Dispatch Cmd+K',
            action_type: 'open_command_bar',
            target: '#/overview',
            score: 40
          });
        }
        missions.sort(function (a, b) { return b.score - a.score; });
        missions.slice(0, 3).forEach(function (mission, index) { mission.rank = index + 1; });

        const orchestrator = getOrchestratorStatus();

        res.json({
          generated_at: new Date().toISOString(),
          counts: {
            tasks: Object.fromEntries(taskCounts.map(function (r) { return [r.status, r.count]; })),
            priorities: Object.fromEntries(priorityCounts.map(function (r) { return [r.priority, r.count]; })),
            runs: Object.fromEntries(runCounts.map(function (r) { return [r.status, r.count]; })),
            projects: Object.fromEntries(projectCounts.map(function (r) { return [r.status, r.count]; })),
            unread_notifications: unreadCount,
            active_dispatches: activeDispatches.size
          },
          missions: missions.slice(0, 3),
          open_tasks: openTasks,
          stale_running_runs: staleRunningRuns,
          recent_runs: recentRuns,
          recent_activity: recentActivity,
          latest_by_agent: latestByAgent,
          active_agent_ids: activeAgentIds,
          orchestrator
        });
        return;
      }

      // POST /api/overview/clean-stale-runs — mark old orphaned running rows as timeout.
      // Skips run_ids that still own a live child process in activeDispatches so the
      // in-memory dispatch map and its callbacks are never invalidated by cleanup.
      if (method === 'POST' && pathname === '/api/overview/clean-stale-runs') {
        const candidates = db.prepare(`
          SELECT ar.*, t.title AS task_title, t.project_id AS project_id
          FROM agent_runs ar LEFT JOIN tasks t ON ar.task_id = t.id
          WHERE ar.status = 'running' AND datetime(ar.started_at) < datetime('now', '-2 hours')
          ORDER BY ar.started_at ASC
        `).all();
        const staleRuns = candidates.filter(function (r) { return !activeDispatches.has(r.id); });
        if (!staleRuns.length) {
          res.json({ cleaned: 0, runs: [], skipped_live: candidates.length });
          return;
        }
        const markRun = db.prepare(`
          UPDATE agent_runs SET status = 'timeout', error = @error,
          duration_ms = CASE
            WHEN started_at IS NOT NULL THEN CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER)
            ELSE duration_ms
          END,
          completed_at = datetime('now')
          WHERE id = @id AND status = 'running'
        `);
        const cleanTx = db.transaction(function (runs) {
          runs.forEach(function (run) {
            markRun.run({ id: run.id, error: 'Marked timeout by Overview stale-run cleanup' });
            stmts.insertActivity.run({
              event_type: 'agent.timeout.cleaned',
              agent_id: run.agent_id,
              task_id: run.task_id,
              project_id: run.project_id || null,
              summary: 'Cleaned stale running row #' + run.id + ' (' + run.agent_id + ')',
              detail_json: JSON.stringify({ run_id: run.id, task_title: run.task_title || null, started_at: run.started_at })
            });
          });
        });
        cleanTx(staleRuns);
        bus.emit('activity:new', { event_type: 'agent.timeout.cleaned', summary: 'Cleaned ' + staleRuns.length + ' stale running row(s)' });
        res.json({ cleaned: staleRuns.length, runs: staleRuns.map(function (r) { return { id: r.id, agent_id: r.agent_id, task_id: r.task_id, task_title: r.task_title }; }) });
        return;
      }

      // GET /api/orchestrator — Hermes persistent orchestrator status
      if (method === 'GET' && pathname === '/api/orchestrator') {
        res.json({ orchestrator: getOrchestratorStatus() });
        return;
      }

      // GET /api/bridge — health check for agent bridge
      if (method === 'GET' && pathname === '/api/bridge') {
        const bReq = http.get('http://127.0.0.1:3335/health', { timeout: 1000 }, (bRes) => {
          let data = '';
          bRes.on('data', (c) => data += c);
          bRes.on('end', () => {
            try {
              const info = JSON.parse(data);
              res.json({ bridge: 'connected', ...info });
            } catch {
              res.json({ bridge: 'error', detail: 'invalid response' });
            }
          });
        });
        bReq.on('error', (e) => res.json({ bridge: 'disconnected', detail: e.message }));
        return;
      }

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

      // GET /api/messages?to=<agent_id> — inter-agent messages
      if (method === 'GET' && pathname === '/api/messages') {
        const toAgent = url.searchParams.get('to');
        const fromAgent = url.searchParams.get('from');
        const limit = Math.min(parseInt(url.searchParams.get('limit'), 10) || 20, 100);
        let messages;
        if (toAgent) {
          messages = db.prepare("SELECT * FROM activity_log WHERE event_type='agent.message' AND detail_json LIKE ? ORDER BY created_at DESC LIMIT ?").all('%"to":"' + toAgent + '"%', limit);
        } else if (fromAgent) {
          messages = db.prepare("SELECT * FROM activity_log WHERE event_type='agent.message' AND agent_id=? ORDER BY created_at DESC LIMIT ?").all(fromAgent, limit);
        } else {
          messages = db.prepare("SELECT * FROM activity_log WHERE event_type='agent.message' ORDER BY created_at DESC LIMIT ?").all(limit);
        }
        res.json({ messages });
        return;
      }

      // POST /api/chat — send message to Jarvis orchestrator, get response
      if (method === 'POST' && pathname === '/api/chat') {
        const body = await readBody(req);
        if (!body || !body.message) {
          res.json({ error: 'message required' }, 400);
          return;
        }
        if (activeChats >= MAX_CHATS) {
          res.json({ error: 'too many concurrent chats, try again soon' }, 429);
          return;
        }
        activeChats++;

        const msg = body.message;

        // Log user message to activity
        stmts.insertActivity.run({
          event_type: 'chat.user', agent_id: 'user', task_id: null,
          project_id: null, summary: 'User: ' + msg.substring(0, 100),
          detail_json: JSON.stringify({ message: msg })
        });

        // Build context-aware prompt for Jarvis
        // Read current dashboard state to give Jarvis awareness
        const boardTasks = stmts.getAllTasks.all();
        const counts = { todo: 0, in_progress: 0, review: 0, done: 0 };
        boardTasks.forEach(function(t) { counts[t.status] = (counts[t.status] || 0) + 1; });

        const recentAct = stmts.getRecentActivity.all(5);
        const actSummary = recentAct.map(function(a) { return a.summary; }).join('; ');

        const chatMsg = '[Dashboard] Board: ' + counts.todo + ' todo, ' + counts.in_progress + ' wip, ' + counts.review + ' review, ' + counts.done + ' done. '
          + 'You can create tasks on the kanban board. To create a task, include CREATE_TASK: title | description | agent_id | priority in your response. '
          + 'To move a task, include MOVE_TASK: task_id | new_status. '
          + 'Current tasks: ' + boardTasks.map(function(t) { return '#' + t.id + ' "' + t.title + '" [' + t.status + ']'; }).join(', ') + '. '
          + msg;

        // Dispatch through Argus's full harness chain (hermes → claude-code →
        // codex) with failover, instead of a hardcoded OpenClaw CLI call.
        const chatEnv = { ...process.env, PATH: process.env.PATH + ':/opt/homebrew/bin:/usr/local/bin' };
        const ceoRow = resolveAgentRow('argus');
        let chatResult;
        try {
          chatResult = await runtimes.executeWithFailover(
            { getRuntime: runtimes.getRuntime, stmts, db },
            ceoRow,
            // Chat is conversational: task actions go through the CREATE_TASK/
            // MOVE_TASK parser below, so the harness gets read-only tools.
            { message: buildAgentPrompt('argus', chatMsg), agentId: 'argus', allowedTools: ['Read', 'Glob', 'Grep', 'WebFetch'] },
            { timeout: 120000, env: chatEnv }
          );
        } catch (err) {
          chatResult = { status: 'error', stdout: '', stderr: (err && err.message) || String(err) };
        }
        activeChats = Math.max(0, activeChats - 1);
        if (!res.writableEnded) {
          if (chatResult.status === 'ok' && chatResult.stdout) {
            const cleaned = cleanCliOutput(chatResult.stdout);
            let responseText = cleaned;
            try {
              const parsed = JSON.parse(cleaned);
              if (parsed.result && parsed.result.payloads) {
                responseText = parsed.result.payloads.map(function(p) { return p.text; }).join('\n');
              } else if (parsed.payloads) {
                responseText = parsed.payloads.map(function(p) { return p.text; }).join('\n');
              }
            } catch { /* use raw */ }

            // Parse task actions from Jarvis response
            const createdTasks = [];
            const createMatch = responseText.match(/CREATE_TASK:\s*(.+?)\s*\|\s*(.+?)(?:\s*\|\s*(.+?))?(?:\s*\|\s*(.+?))?(?:\n|$)/i);
            // Guard: harnesses that echo the prompt reflect the instruction
            // template itself ("CREATE_TASK: title | description | …") — never
            // create a task from the template literal.
            if (createMatch && createMatch[1].trim().toLowerCase() === 'title'
              && createMatch[2].trim().toLowerCase() === 'description') {
              createMatch.length = 0;
            }
            if (createMatch && createMatch.length) {
              const title = createMatch[1].trim();
              const desc = createMatch[2].trim();
              const agent = (createMatch[3] || '').trim() || null;
              const priority = (createMatch[4] || 'medium').trim().toLowerCase();
              const validPriorities = ['critical', 'high', 'medium', 'low'];
              const finalPriority = validPriorities.includes(priority) ? priority : 'medium';
              const validAgent = agent && validAgentIds.includes(agent) ? agent : null;

              const result = stmts.insertTask.run({
                title: title, description: desc === '-' ? null : desc, status: 'todo',
                priority: finalPriority, agent_id: validAgent, project_id: null, sort_order: 0
              });
              const task = stmts.getTaskById.get(result.lastInsertRowid);
              stmts.insertActivity.run({
                event_type: 'task.created', agent_id: 'argus', task_id: task.id,
                project_id: null, summary: 'Argus created task: ' + task.title,
                detail_json: JSON.stringify(task)
              });
              bus.emit('task:created', task);
              bus.emit('activity:new', { event_type: 'task.created', summary: 'Argus created task: ' + task.title, task_id: task.id });
              bridgePublish('task.created', { task: task }, 'argus');
              createdTasks.push(task);
            }

            const movedTasks = [];
            const moveMatch = responseText.match(/MOVE_TASK:\s*(\d+)\s*\|\s*(todo|in_progress|review|done)(?:\n|$)/i);
            if (moveMatch) {
              const moveId = parseInt(moveMatch[1], 10);
              const newStatus = moveMatch[2].toLowerCase();
              const existing = stmts.getTaskById.get(moveId);
              if (existing) {
                stmts.updateTask.run({
                  id: moveId, title: existing.title, description: existing.description,
                  status: newStatus, priority: existing.priority,
                  agent_id: existing.agent_id, sort_order: existing.sort_order
                });
                const moved = stmts.getTaskById.get(moveId);
                bus.emit('task:updated', moved);
                bridgePublish('task.updated', { task: moved, previous_status: existing.status }, 'argus');
                movedTasks.push(moved);
              }
            }

            stmts.insertActivity.run({
              event_type: 'chat.agent', agent_id: 'argus', task_id: createdTasks.length ? createdTasks[0].id : null,
              project_id: null, summary: 'Argus: ' + responseText.substring(0, 100),
              detail_json: JSON.stringify({ response: responseText, created_tasks: createdTasks, moved_tasks: movedTasks })
            });
            bus.emit('activity:new', { event_type: 'chat.agent', agent_id: 'argus', summary: 'Argus responded' });

            res.json({ agent: 'argus', response: responseText, created_tasks: createdTasks, moved_tasks: movedTasks, harness: chatResult.harness });
          } else {
            res.json({ agent: 'argus', response: 'Error: ' + String(chatResult.stderr || chatResult.status || 'unknown').substring(0, 200) }, 500);
          }
        }
        return;
      }

      // POST /api/messages — send inter-agent message
      if (method === 'POST' && pathname === '/api/messages') {
        const body = await readBody(req);
        if (!body || !body.from || !body.to || !body.subject) {
          res.json({ error: 'from, to, and subject required' }, 400);
          return;
        }
        postAgentMessage(body.from, body.to, body.subject, body.body || '', body.task_id || null);
        res.json({ ok: true });
        return;
      }

      // GET /api/settings/watchdog — watchdog kill-switch + cooldown config (read by watchdog.py)
      if (method === 'GET' && pathname === '/api/settings/watchdog') {
        const row = stmts.getWatchdogSettings.get();
        const defaults = { auto_nudge_enabled: false, nudge_cooldown_seconds: 900 };
        const saved = row ? safeJsonParse(row.value_json, {}) : {};
        res.json({ watchdog: { ...defaults, ...saved } });
        return;
      }

      // GET /api/settings + PUT /api/settings
      if (method === 'GET' && pathname === '/api/settings') {
        res.json({ settings: getAppSettings(), runtimes: await runtimes.listRuntimes() });
        return;
      }
      if (method === 'PUT' && pathname === '/api/settings') {
        const body = await readBody(req);
        try {
          const settings = saveAppSettings(body || {});
          stmts.insertActivity.run({
            event_type: 'settings.updated', agent_id: 'system', task_id: null,
            project_id: null, summary: 'Operator settings updated',
            detail_json: JSON.stringify({ settings })
          });
          bus.emit('activity:new', { event_type: 'settings.updated', agent_id: 'system', summary: 'Operator settings updated' });
          res.json({ settings, restart_required: true, restart_fields: ['port', 'workspace_path'] });
        } catch (err) {
          res.json({ error: err.message }, 400);
        }
        return;
      }

      // GET /api/runtimes
      if (method === 'GET' && pathname === '/api/runtimes') {
        res.json({ runtimes: await runtimes.listRuntimes() });
        return;
      }

      // GET /api/cookbook — model inventory per available harness
      if (method === 'GET' && pathname === '/api/cookbook') {
        const inventory = await cookbook.inventory(await runtimes.listRuntimes());
        res.json({ inventory });
        return;
      }

      // POST /api/research — kick off a Deep Research run on an agent
      if (method === 'POST' && pathname === '/api/research') {
        const body = await readBody(req);
        if (!body || !body.question || !body.agent_id) {
          res.json({ error: 'agent_id and question are required' }, 400); return;
        }
        const agent = stmts.getAgentById.get(body.agent_id);
        if (!agent) { res.json({ error: 'Agent not found' }, 404); return; }

        const dispatchFn = async function (message, _phaseMeta) {
          const ctx = { message: String(message), allowedTools: body.allowed_tools, maxTurns: body.max_turns };
          return await runtimes.executeWithFailover(
            { getRuntime: runtimes.getRuntime, stmts, db },
            agent, ctx,
            { timeout: body.per_step_timeout || 180000, replayTurns: 0 }
          );
        };
        const result = await deepResearch.runResearch({ dispatch: dispatchFn }, {
          question: String(body.question),
          maxQueries: body.max_queries || 5
        });
        stmts.insertActivity.run({
          event_type: 'research.completed',
          agent_id: agent.id, task_id: null, project_id: null,
          summary: 'Research: ' + result.question.substring(0, 80),
          detail_json: JSON.stringify({ sub_queries: result.subQueries, errors: result.errors })
        });
        bus.emit('activity:new', { event_type: 'research.completed', summary: 'Research: ' + result.question.substring(0, 80) });
        res.json(result);
        return;
      }

      // Schedules CRUD (cron-style scheduled agent runs)
      if (method === 'GET' && pathname === '/api/schedules') {
        res.json({ schedules: stmts.getAllSchedules.all() }); return;
      }
      if (method === 'POST' && pathname === '/api/schedules') {
        const body = await readBody(req);
        if (!body || !body.agent_id || !body.name || !body.cron || !body.prompt) {
          res.json({ error: 'agent_id, name, cron, prompt required' }, 400); return;
        }
        try { scheduler.parseCron(body.cron); }
        catch (err) { res.json({ error: 'Invalid cron: ' + err.message }, 400); return; }
        const result = stmts.insertSchedule.run({
          agent_id: body.agent_id, name: body.name, cron: body.cron,
          prompt: body.prompt, enabled: body.enabled === false ? 0 : 1
        });
        res.json({ schedule: stmts.getScheduleById.get(result.lastInsertRowid) }, 201);
        return;
      }
      if (method === 'PATCH' && /^\/api\/schedules\/(\d+)$/.test(pathname)) {
        const id = parseInt(pathname.match(/^\/api\/schedules\/(\d+)$/)[1], 10);
        const existing = stmts.getScheduleById.get(id);
        if (!existing) { res.json({ error: 'Schedule not found' }, 404); return; }
        const body = await readBody(req) || {};
        stmts.updateSchedule.run({
          id,
          agent_id: body.agent_id !== undefined ? body.agent_id : existing.agent_id,
          name:     body.name     !== undefined ? body.name     : existing.name,
          cron:     body.cron     !== undefined ? body.cron     : existing.cron,
          prompt:   body.prompt   !== undefined ? body.prompt   : existing.prompt,
          enabled:  body.enabled  !== undefined ? (body.enabled ? 1 : 0) : existing.enabled
        });
        res.json({ schedule: stmts.getScheduleById.get(id) }); return;
      }
      if (method === 'DELETE' && /^\/api\/schedules\/(\d+)$/.test(pathname)) {
        const id = parseInt(pathname.match(/^\/api\/schedules\/(\d+)$/)[1], 10);
        stmts.deleteSchedule.run(id);
        res.json({ deleted: true }); return;
      }

      // POST /api/cleanup — manual prune of audit tables
      if (method === 'POST' && pathname === '/api/cleanup') {
        const body = await readBody(req) || {};
        res.json(cleanup.runPrune(stmts, body)); return;
      }

      // POST /api/guardrails/scan — scan arbitrary text for jailbreak patterns
      if (method === 'POST' && pathname === '/api/guardrails/scan') {
        const body = await readBody(req);
        if (!body || typeof body.text !== 'string') {
          res.json({ error: 'text is required' }, 400); return;
        }
        const hits = guardrails.detectJailbreak(body.text);
        const tokens = guardrails.estimateTokens(body.text);
        res.json({ jailbreak_hits: hits, estimated_tokens: tokens });
        return;
      }

      // GET /api/org — full org chart with live state
      if (method === 'GET' && pathname === '/api/org') {
        const allAgents = stmts.getAllAgentRuntimes.all();
        const byId = {};
        allAgents.forEach((a) => {
          let chain = [];
          try { chain = JSON.parse(a.harness_chain || '[]'); } catch { chain = []; }
          byId[a.id] = {
            id: a.id,
            name: a.name || a.id,
            title: a.title,
            role: a.role,
            reports_to: a.reports_to,
            personality_path: a.personality_path,
            harness_chain: chain,
            current_harness: a.current_harness,
            health_status: a.health_status,
            last_health_check: a.last_health_check,
            last_activity_at: a.last_activity_at,
            watchdog_role: a.watchdog_role,
            expected_activity_within_seconds: a.expected_activity_within_seconds,
            last_nudge_at: a.last_nudge_at || null,
            reports: []
          };
        });
        // Build reports[] tree
        Object.values(byId).forEach((node) => {
          if (node.reports_to && byId[node.reports_to]) byId[node.reports_to].reports.push(node);
        });
        const ceo = Object.values(byId).find((n) => n.role === 'ceo');
        // Role-less rows are legacy flat-registry duplicates (e.g. the old
        // "main"/"hermes" seeds) that the org chart shouldn't render as stray nodes.
        const isOrgNode = (n) => !!n.role;
        const orphans = Object.values(byId).filter((n) => !n.reports_to && n.role && n.role !== 'ceo');
        res.json({ ceo: ceo || null, orphans, all: Object.values(byId).filter(isOrgNode) });
        return;
      }

      // GET /api/agents/:id/messages — recent conversation (newest first)
      if (method === 'GET' && /^\/api\/agents\/[\w-]+\/messages$/.test(pathname)) {
        const id = pathname.match(/^\/api\/agents\/([\w-]+)\/messages$/)[1];
        const limitParam = parseInt(url.searchParams.get('limit') || '20', 10);
        const limit = Math.min(Math.max(limitParam, 1), 200);
        res.json({ messages: stmts.getRecentAgentMessages.all(id, limit) });
        return;
      }

      // GET /api/agents/:id/health — snapshot
      if (method === 'GET' && /^\/api\/agents\/[\w-]+\/health$/.test(pathname)) {
        const id = pathname.match(/^\/api\/agents\/([\w-]+)\/health$/)[1];
        const agent = stmts.getAgentById.get(id);
        if (!agent) { res.json({ error: 'Agent not found' }, 404); return; }
        res.json({
          id: agent.id,
          health_status: agent.health_status,
          last_health_check: agent.last_health_check,
          last_activity_at: agent.last_activity_at,
          current_harness: agent.current_harness
        });
        return;
      }

      // POST /api/agents/:id/dispatch — run a prompt with full failover
      if (method === 'POST' && /^\/api\/agents\/[\w-]+\/dispatch$/.test(pathname)) {
        const id = pathname.match(/^\/api\/agents\/([\w-]+)\/dispatch$/)[1];
        const agent = stmts.getAgentById.get(id);
        if (!agent) { res.json({ error: 'Agent not found' }, 404); return; }
        const body = await readBody(req);
        if (!body || !body.message) { res.json({ error: 'message is required' }, 400); return; }
        const ctx = { message: String(body.message) };
        if (Array.isArray(body.allowed_tools)) ctx.allowedTools = body.allowed_tools;
        if (typeof body.max_turns === 'number') ctx.maxTurns = body.max_turns;
        if (body.dangerously_skip_permissions === true) ctx.dangerouslySkipPermissions = true;
        const failoverOpts = { timeout: body.timeout || 120000, replayTurns: body.replay_turns || 10 };
        if (typeof body.replay_budget === 'number') failoverOpts.replayBudget = body.replay_budget;
        const result = await runtimes.executeWithFailover(
          { getRuntime: runtimes.getRuntime, stmts, db },
          agent,
          ctx,
          failoverOpts
        );
        stmts.insertActivity.run({
          event_type: result.status === 'ok' ? 'agent.dispatched' : 'agent.failed',
          agent_id: agent.id, task_id: null, project_id: null,
          summary: agent.name + ' dispatch via ' + (result.harness || 'none') + ' (' + result.status + ')',
          detail_json: JSON.stringify({ attempts: result.attempts, replayed: result.replayed })
        });
        // Update last_nudge_at so watchdog cooldown resets on any successful agent dispatch.
        if (result.status === 'ok') stmts.setAgentNudgeAt.run(agent.id);
        bus.emit('activity:new', { event_type: 'agent.dispatched', summary: agent.name + ' → ' + result.status });
        res.json(result);
        return;
      }

      // GET /api/agents/:id/throttle — return current bucket state
      if (method === 'GET' && /^\/api\/agents\/[\w-]+\/throttle$/.test(pathname)) {
        const id = pathname.match(/^\/api\/agents\/([\w-]+)\/throttle$/)[1];
        const agent = stmts.getAgentById.get(id);
        if (!agent) { res.json({ error: 'Agent not found' }, 404); return; }
        res.json({ agent_id: id, throttle: rateLimiter.status(id) });
        return;
      }

      // PUT /api/agents/:id/throttle — reconfigure per-agent bucket
      if (method === 'PUT' && /^\/api\/agents\/[\w-]+\/throttle$/.test(pathname)) {
        const id = pathname.match(/^\/api\/agents\/([\w-]+)\/throttle$/)[1];
        const agent = stmts.getAgentById.get(id);
        if (!agent) { res.json({ error: 'Agent not found' }, 404); return; }
        const body = await readBody(req);
        const capacity = Number(body && body.capacity) || 0;
        const refillPerSecond = Number(body && body.refill_per_second) || 0;
        if (!capacity || !refillPerSecond) { res.json({ error: 'capacity and refill_per_second are required' }, 400); return; }
        rateLimiter.configure(id, capacity, refillPerSecond);
        res.json({ agent_id: id, throttle: rateLimiter.status(id) });
        return;
      }

      // POST /api/agents/:id/health-check — run healthcheck on current_harness, update DB
      if (method === 'POST' && /^\/api\/agents\/[\w-]+\/health-check$/.test(pathname)) {
        const id = pathname.match(/^\/api\/agents\/([\w-]+)\/health-check$/)[1];
        const agent = stmts.getAgentById.get(id);
        if (!agent) { res.json({ error: 'Agent not found' }, 404); return; }
        let runtime;
        try { runtime = runtimes.getRuntime(agent.current_harness || 'openclaw'); }
        catch (err) {
          stmts.setAgentHealth.run('fail', id);
          stmts.insertHealthLog.run({ agent_id: id, harness: agent.current_harness, status: 'fail', detail: err.message });
          res.json({ ok: false, error: err.message }, 200);
          return;
        }
        const result = await Promise.resolve(runtime.healthcheck());
        const status = result && result.ok ? 'ok' : 'fail';
        stmts.setAgentHealth.run(status, id);
        stmts.insertHealthLog.run({
          agent_id: id, harness: agent.current_harness,
          status, detail: result && result.error ? result.error : null
        });
        res.json({ id, harness: agent.current_harness, status, raw: result });
        return;
      }

      // GET /api/agents
      if (method === 'GET' && pathname === '/api/agents') {
        const latestRuns = stmts.getLatestRunPerAgent.all();
        const runningAgents = stmts.getRunningAgents.all().map(r => r.agent_id);
        const runMap = {};
        latestRuns.forEach(function (r) { runMap[r.agent_id] = r; });
        const agents = agentConfigs.map(function (baseCfg) {
          const cfg = resolveAgentConfig(baseCfg.id) || baseCfg;
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
            runtime: cfg.runtime,
            color: cfg.color,
            status: status,
            last_activity: run ? (run.completed_at || run.started_at) : null,
            last_run_status: run ? run.status : null,
            last_run_duration_ms: run ? run.duration_ms : null,
            last_run_summary: run && run.result_text ? extractResultText(run.result_text).substring(0, 120) : null,
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
        } else if (body.auto_route === true && (agentId === 'argus' || agentId === 'jarvis')) {
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

        // Mark cancelled first so the callback won't apply completion state
        info.cancelled = true;

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

      // GET /api/runs/:id -- single run with parsed artifacts
      if (method === 'GET' && /^\/api\/runs\/(\d+)$/.test(pathname)) {
        const runId = parseInt(pathname.match(/^\/api\/runs\/(\d+)$/)[1], 10);
        const run = stmts.getRunById.get(runId);
        if (!run) { res.json({ error: 'Run not found' }, 404); return; }
        let artifacts = [];
        try { artifacts = JSON.parse(run.artifacts_json || '[]'); } catch { artifacts = []; }
        res.json({ run, artifacts });
        return;
      }

      // POST /api/runs/:id/open -- open the run's workdir (or a file inside it)
      // in Finder / the default app. Paths are confined to the run's workdir.
      if (method === 'POST' && /^\/api\/runs\/(\d+)\/open$/.test(pathname)) {
        const runId = parseInt(pathname.match(/^\/api\/runs\/(\d+)\/open$/)[1], 10);
        const run = stmts.getRunById.get(runId);
        if (!run) { res.json({ error: 'Run not found' }, 404); return; }
        if (!run.workdir) { res.json({ error: 'Run has no working directory recorded' }, 404); return; }
        const body = (await readBody(req)) || {};
        let target = run.workdir;
        if (body.path) {
          const resolved = path.resolve(run.workdir, String(body.path));
          let realTarget, realRoot;
          try {
            realTarget = fs.realpathSync(resolved);
            realRoot = fs.realpathSync(run.workdir);
          } catch { res.json({ error: 'Not found on disk: ' + resolved }, 404); return; }
          // Compare realpaths so a symlink inside the workdir can't escape it.
          if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
            res.json({ error: 'Path escapes the run workdir' }, 400);
            return;
          }
          if (/\.(app|command|tool|sh|zsh|scpt|terminal|pkg|dmg)$/i.test(realTarget)) {
            res.json({ error: 'Refusing to open executable bundles from the dashboard' }, 400);
            return;
          }
          target = realTarget;
        }
        if (!fs.existsSync(target)) { res.json({ error: 'Not found on disk: ' + target }, 404); return; }
        const openArgs = body.reveal ? ['-R', target] : [target];
        execFile('open', openArgs, (err) => {
          if (err) { res.json({ error: 'open failed: ' + err.message }, 500); return; }
          res.json({ ok: true, opened: target });
        });
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

      // GET /api/crons -- cron schedule from OpenClaw CLI (cached 60s)
      if (method === 'GET' && pathname === '/api/crons') {
        const now = Date.now();
        if (cronCache.data && (now - cronCache.ts) < 60000) {
          res.json(cronCache.data);
          return;
        }
        execFile('openclaw', ['cron', 'list', '--json'], {
          timeout: 15000,
          env: { ...process.env, PATH: process.env.PATH + ':/opt/homebrew/bin:/usr/local/bin' }
        }, (error, stdout) => {
          let result;
          if (error) {
            result = { crons: { jobs: [] }, source: 'error' };
          } else {
            try {
              const cleaned = cleanCliOutput(stdout);
              const parsed = JSON.parse(cleaned);
              result = { crons: parsed.crons || parsed, source: 'live' };
            } catch {
              result = { crons: { jobs: [] }, source: 'parse-error' };
            }
          }
          cronCache = { data: result, ts: Date.now() };
          res.json(result);
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
            // Explicit single-file fallback for the top-level memory index only.
            if (filename === 'MEMORY.md') {
              content = fs.readFileSync(path.join(WORKSPACE, 'MEMORY.md'), 'utf8');
            } else {
              throw new Error('not found');
            }
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
          'agent', '--local', '--agent', 'main', '--message', cliMessage, '--json', '--timeout', '30'
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
          'agent', '--local', '--agent', 'main', '--message', convoContext, '--json', '--timeout', '30'
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
        const useAgent = agentOverride || session.suggested_agent || 'argus';

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

      // ===== Spaces CRUD (workspace grouping above Projects) =====

      // GET /api/spaces — list spaces with project count
      if (method === 'GET' && pathname === '/api/spaces') {
        const spaces = stmts.getAllSpaces.all();
        res.json({ spaces: spaces });
        return;
      }

      // GET /api/spaces/:id — one space + nested projects
      if (method === 'GET' && /^\/api\/spaces\/(\d+)$/.test(pathname)) {
        const spaceId = parseInt(pathname.match(/^\/api\/spaces\/(\d+)$/)[1], 10);
        const space = stmts.getSpaceById.get(spaceId);
        if (!space) { res.json({ error: 'Space not found' }, 404); return; }
        const projects = stmts.getProjectsBySpace.all(spaceId);
        res.json({ space: space, projects: projects });
        return;
      }

      // POST /api/spaces
      if (method === 'POST' && pathname === '/api/spaces') {
        const body = await readBody(req);
        if (!body || !body.name || typeof body.name !== 'string' || !body.name.trim()) {
          res.json({ error: 'name is required' }, 400); return;
        }
        const slug = body.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        if (!slug) { res.json({ error: 'Invalid space name' }, 400); return; }
        try {
          const result = stmts.insertSpace.run({
            name: body.name.trim(), slug: slug,
            description: body.description || null,
            color: body.color || '#FF2EC4',
            sort_order: typeof body.sort_order === 'number' ? body.sort_order : 0
          });
          const space = stmts.getSpaceById.get(result.lastInsertRowid);
          stmts.insertActivity.run({
            event_type: 'space.created', agent_id: null, task_id: null, project_id: null,
            summary: 'Space created: ' + space.name, detail_json: JSON.stringify(space)
          });
          bus.emit('activity:new', { event_type: 'space.created', summary: 'Space created: ' + space.name });
          res.json({ space: space }, 201);
        } catch (err) {
          if (err.message && err.message.indexOf('UNIQUE') !== -1) {
            res.json({ error: 'Space slug already exists' }, 409);
          } else { throw err; }
        }
        return;
      }

      // PATCH /api/spaces/:id
      if (method === 'PATCH' && /^\/api\/spaces\/(\d+)$/.test(pathname)) {
        const spaceId = parseInt(pathname.match(/^\/api\/spaces\/(\d+)$/)[1], 10);
        const existing = stmts.getSpaceById.get(spaceId);
        if (!existing) { res.json({ error: 'Space not found' }, 404); return; }
        const body = await readBody(req);
        if (!body) { res.json({ error: 'Request body required' }, 400); return; }
        stmts.updateSpace.run({
          id: spaceId,
          name: body.name !== undefined ? body.name : existing.name,
          description: body.description !== undefined ? body.description : existing.description,
          color: body.color !== undefined ? body.color : existing.color,
          sort_order: body.sort_order !== undefined ? body.sort_order : existing.sort_order
        });
        const updated = stmts.getSpaceById.get(spaceId);
        bus.emit('activity:new', { event_type: 'space.updated', summary: 'Space updated: ' + updated.name });
        res.json({ space: updated });
        return;
      }

      // DELETE /api/spaces/:id — block when the space still has projects
      if (method === 'DELETE' && /^\/api\/spaces\/(\d+)$/.test(pathname)) {
        const spaceId = parseInt(pathname.match(/^\/api\/spaces\/(\d+)$/)[1], 10);
        if (spaceId === 1) { res.json({ error: 'Default Personal space cannot be deleted' }, 400); return; }
        const existing = stmts.getSpaceById.get(spaceId);
        if (!existing) { res.json({ error: 'Space not found' }, 404); return; }
        const count = stmts.countProjectsInSpace.get(spaceId);
        if (count && count.count > 0) {
          res.json({ error: 'Space has ' + count.count + ' project(s). Move or delete them first.' }, 409);
          return;
        }
        stmts.deleteSpace.run(spaceId);
        bus.emit('activity:new', { event_type: 'space.deleted', summary: 'Space deleted: ' + existing.name });
        res.json({ deleted: true });
        return;
      }

      // ===== INTEL-03: Project CRUD =====

      // GET /api/projects — optional ?space_id= filter
      if (method === 'GET' && pathname === '/api/projects') {
        const spaceIdParam = url.searchParams.get('space_id');
        const projects = spaceIdParam
          ? stmts.getProjectsBySpace.all(parseInt(spaceIdParam, 10))
          : stmts.getAllProjects.all();
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
            color: body.color || '#00ff41',
            space_id: typeof body.space_id === 'number' ? body.space_id : 1
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
          status: body.status !== undefined ? body.status : existing.status,
          space_id: body.space_id !== undefined ? body.space_id : existing.space_id
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

      // GET /api/export — full DB dump as JSON attachment
      if (method === 'GET' && pathname === '/api/export') {
        const exportedAt = new Date().toISOString();
        const timestamp = exportedAt.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
        const payload = {
          schema_version: 1,
          exported_at: exportedAt,
          tables: {
            projects: stmts.exportProjects.all(),
            tasks: stmts.exportTasks.all(),
            agent_runs: stmts.exportAgentRuns.all(),
            notifications: stmts.exportNotifications.all(),
            activity_log: stmts.exportActivityLog.all()
          }
        };
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="visionary-backup-${timestamp}.json"`
        });
        res.end(JSON.stringify(payload));
        return;
      }

      // POST /api/import — restore from JSON export, idempotent via INSERT OR REPLACE
      if (method === 'POST' && pathname === '/api/import') {
        const body = await readBody(req);
        if (!body) { res.json({ error: 'Request body required' }, 400); return; }
        if (body.schema_version !== 1) {
          res.json({ error: 'Unsupported schema_version: ' + body.schema_version }, 422);
          return;
        }
        const tables = body.tables;
        if (!tables || typeof tables !== 'object') {
          res.json({ error: 'Missing tables in import payload' }, 400);
          return;
        }
        const counts = { projects: 0, tasks: 0, agent_runs: 0, notifications: 0, activity_log: 0 };
        const doImport = db.transaction(() => {
          const projects = Array.isArray(tables.projects) ? tables.projects : [];
          for (const row of projects) { stmts.importProject.run(row); counts.projects++; }
          const tasks = Array.isArray(tables.tasks) ? tables.tasks : [];
          for (const row of tasks) { stmts.importTask.run(row); counts.tasks++; }
          const agentRuns = Array.isArray(tables.agent_runs) ? tables.agent_runs : [];
          for (const row of agentRuns) { stmts.importAgentRun.run(row); counts.agent_runs++; }
          const notifications = Array.isArray(tables.notifications) ? tables.notifications : [];
          for (const row of notifications) { stmts.importNotification.run(row); counts.notifications++; }
          const activityLog = Array.isArray(tables.activity_log) ? tables.activity_log : [];
          for (const row of activityLog) { stmts.importActivityLog.run(row); counts.activity_log++; }
        });
        doImport();
        res.json({ imported: counts });
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

spawnBridge();

// Scheduler tick — every minute, fire any matching schedules.
// fireSchedule routes through executeWithFailover so each scheduled run
// gets the full failover chain.
async function fireSchedule(schedule) {
  const agent = stmts.getAgentById.get(schedule.agent_id);
  if (!agent) return { status: 'error', detail: 'agent not found: ' + schedule.agent_id };
  const result = await runtimes.executeWithFailover(
    { getRuntime: runtimes.getRuntime, stmts, db },
    agent,
    { message: schedule.prompt },
    { timeout: 600000, replayTurns: 0 }
  );
  bus.emit('activity:new', {
    event_type: 'schedule.fired',
    summary: 'Schedule "' + schedule.name + '" → ' + agent.name + ' (' + result.status + ')'
  });
  return { status: result.status, detail: (result.harness || '') + ': ' + (result.stdout || '').slice(0, 200) };
}
setInterval(() => {
  scheduler.tick({ stmts, fireSchedule }).catch((err) => {
    console.error('[scheduler] tick error:', err.message);
  });
}, 60000);

// Cleanup tick — once on boot, then daily. Idempotent.
function bootAndDailyCleanup() {
  try {
    const result = cleanup.runPrune(stmts);
    console.log('[cleanup] pruned:', JSON.stringify(result));
  } catch (err) { console.error('[cleanup] error:', err.message); }
}
setTimeout(bootAndDailyCleanup, 10000);
setInterval(bootAndDailyCleanup, 24 * 60 * 60 * 1000);

const PORT = parseInt(process.env.VISIONARY_PORT, 10) || 3333;
const HOST = process.env.VISIONARY_HOST || '127.0.0.1';
server.listen(PORT, HOST, () => {
  console.log('Visionary Mission Control running at http://' + HOST + ':' + PORT);
  const settings = getAppSettings();
  console.log('[boot] workspace: ' + settings.workspace_path);
  // Probe each harness once at boot so the operator sees what is actually wired.
  Promise.resolve(runtimes.listRuntimes()).then(function (list) {
    const ok = list.filter(function (r) { return r.health && r.health.ok; }).map(function (r) { return r.id; });
    const down = list.filter(function (r) { return !(r.health && r.health.ok); }).map(function (r) { return r.id; });
    console.log('[boot] harnesses available: ' + (ok.join(', ') || 'none'));
    if (down.length) console.log('[boot] harnesses unavailable: ' + down.join(', '));
  }).catch(function () { /* non-fatal */ });
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
function shutdownBridge() {
  if (bridgeProcess) {
    try { bridgeProcess.kill('SIGTERM'); } catch {}
    bridgeProcess = null;
  }
}

process.on('SIGINT', () => {
  for (const [, info] of activeDispatches) {
    try { info.process.kill('SIGTERM'); } catch {}
  }
  shutdownBridge();
  db.close();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  for (const [, info] of activeDispatches) {
    try { info.process.kill('SIGTERM'); } catch {}
  }
  shutdownBridge();
  db.close();
  server.close();
  process.exit(0);
});
