const Database = require('better-sqlite3');
const DB_PATH = process.env.VISIONARY_DB || './visionary.sqlite';
const db = new Database(DB_PATH);

// PRAGMAs -- WAL first, then the rest
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('cache_size = -20000');
db.pragma('temp_store = MEMORY');

// Migration system
db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL DEFAULT 0)');
db.prepare('INSERT OR IGNORE INTO schema_version (rowid, version) VALUES (1, 0)').run();

const migrations = [
  // Migration 0 -> 1: Create all 5 tables with CHECK constraints and indexes
  `
  CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    color TEXT DEFAULT '#00ff41',
    status TEXT DEFAULT 'active' CHECK(status IN ('active','paused','archived')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id),
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'todo' CHECK(status IN ('todo','in_progress','review','done')),
    priority TEXT DEFAULT 'medium' CHECK(priority IN ('critical','high','medium','low')),
    agent_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE agent_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER REFERENCES tasks(id),
    agent_id TEXT NOT NULL,
    session_id TEXT,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','timeout')),
    result_json TEXT,
    result_text TEXT,
    error TEXT,
    delivery_status TEXT,
    duration_ms INTEGER,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_run_id INTEGER REFERENCES agent_runs(id),
    type TEXT NOT NULL CHECK(type IN ('info','action','warning','error')),
    title TEXT NOT NULL,
    body TEXT,
    action_type TEXT,
    action_data TEXT,
    read INTEGER DEFAULT 0,
    dismissed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    agent_id TEXT,
    task_id INTEGER,
    project_id INTEGER,
    summary TEXT NOT NULL,
    detail_json TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX idx_tasks_status ON tasks(status);
  CREATE INDEX idx_tasks_project ON tasks(project_id);
  CREATE INDEX idx_agent_runs_task ON agent_runs(task_id);
  CREATE INDEX idx_agent_runs_status ON agent_runs(status);
  CREATE INDEX idx_notifications_read ON notifications(read);
  CREATE INDEX idx_activity_created ON activity_log(created_at DESC);
  CREATE INDEX idx_activity_agent ON activity_log(agent_id);
  `,

  // Migration 1 -> 2: Interview sessions, token columns, project indexes
  `
  CREATE TABLE IF NOT EXISTS interview_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER REFERENCES tasks(id),
    status TEXT DEFAULT 'active' CHECK(status IN ('active','completed','cancelled')),
    messages_json TEXT DEFAULT '[]',
    refined_title TEXT,
    refined_description TEXT,
    suggested_agent TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  ALTER TABLE agent_runs ADD COLUMN input_tokens INTEGER;
  ALTER TABLE agent_runs ADD COLUMN output_tokens INTEGER;
  ALTER TABLE agent_runs ADD COLUMN estimated_cost_usd REAL;

  CREATE INDEX idx_interview_task ON interview_sessions(task_id);
  CREATE INDEX idx_projects_status ON projects(status);
  `,

  // Migration 2 -> 3: Runtime registry metadata + operator settings
  `
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT,
    runtime TEXT DEFAULT 'openclaw' NOT NULL,
    config_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  INSERT OR IGNORE INTO settings (key, value_json) VALUES ('app', '{}');
  `,

  // Migration 3 -> 4: Spaces (workspaces) for grouping projects
  `
  CREATE TABLE IF NOT EXISTS spaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    color TEXT DEFAULT '#FF2EC4',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  INSERT OR IGNORE INTO spaces (id, name, slug, description, color, sort_order)
  VALUES (1, 'Personal', 'personal', 'Default space for solo work.', '#FF2EC4', 0);

  ALTER TABLE projects ADD COLUMN space_id INTEGER REFERENCES spaces(id);

  UPDATE projects SET space_id = 1 WHERE space_id IS NULL;

  CREATE INDEX idx_projects_space ON projects(space_id);
  `,

  // Migration 4 -> 5: Org-chart fields on agents + conversation replay buffer
  `
  ALTER TABLE agents ADD COLUMN personality_path TEXT;
  ALTER TABLE agents ADD COLUMN title TEXT;
  ALTER TABLE agents ADD COLUMN role TEXT;
  ALTER TABLE agents ADD COLUMN reports_to TEXT;
  ALTER TABLE agents ADD COLUMN harness_chain TEXT DEFAULT '["openclaw"]' NOT NULL;
  ALTER TABLE agents ADD COLUMN current_harness TEXT DEFAULT 'openclaw' NOT NULL;
  ALTER TABLE agents ADD COLUMN health_status TEXT DEFAULT 'unknown' NOT NULL;
  ALTER TABLE agents ADD COLUMN last_health_check TEXT;
  ALTER TABLE agents ADD COLUMN last_activity_at TEXT;
  ALTER TABLE agents ADD COLUMN watchdog_role TEXT;
  ALTER TABLE agents ADD COLUMN expected_activity_within_seconds INTEGER DEFAULT 7200;

  CREATE TABLE IF NOT EXISTS agent_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('system','user','assistant','tool')),
    content TEXT NOT NULL,
    harness TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_agent_messages_agent ON agent_messages(agent_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS agent_health_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    harness TEXT,
    status TEXT NOT NULL,
    detail TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_agent_health_agent ON agent_health_log(agent_id, created_at DESC);
  `
];

// Migration runner
const runMigrations = db.transaction(() => {
  const current = db.prepare('SELECT version FROM schema_version WHERE rowid = 1').get();
  let version = current.version;
  for (let i = version; i < migrations.length; i++) {
    db.exec(migrations[i]);
    version = i + 1;
    db.prepare('UPDATE schema_version SET version = ? WHERE rowid = 1').run(version);
  }
});
runMigrations();

// --- Org-chart bootstrap: seed agents from personalities/org-chart.json ---
// Reloaded on every boot so the file is the source of truth. Updates only the
// columns that come from the chart; runtime state (current_harness, health,
// last_activity_at) is preserved if the agent already exists.
function bootstrapOrgChart() {
  const fs = require('node:fs');
  const path = require('node:path');
  const chartPath = path.join(__dirname, 'personalities', 'org-chart.json');
  if (!fs.existsSync(chartPath)) return;
  let chart;
  try { chart = JSON.parse(fs.readFileSync(chartPath, 'utf-8')); }
  catch (err) { console.error('[org-chart] parse error:', err.message); return; }

  const defaults = chart.defaults || {};
  const upsert = db.prepare(`
    INSERT INTO agents (
      id, name, runtime, title, role, reports_to,
      personality_path, harness_chain, current_harness,
      watchdog_role, expected_activity_within_seconds, updated_at
    ) VALUES (
      @id, @name, @runtime, @title, @role, @reports_to,
      @personality_path, @harness_chain, @current_harness,
      @watchdog_role, @expected_activity_within_seconds, datetime('now')
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      title = excluded.title,
      role = excluded.role,
      reports_to = excluded.reports_to,
      personality_path = excluded.personality_path,
      harness_chain = excluded.harness_chain,
      watchdog_role = excluded.watchdog_role,
      expected_activity_within_seconds = excluded.expected_activity_within_seconds,
      updated_at = datetime('now')
  `);

  function seed(node, reportsTo, role) {
    const harnessChain = node.harness_chain || defaults.harness_chain || ['openclaw'];
    const watchdog = node.watchdog || {};
    upsert.run({
      id: node.id,
      name: node.name || node.id,
      runtime: harnessChain[0],
      title: node.title || null,
      role: role,
      reports_to: reportsTo,
      personality_path: node.personality_path || null,
      harness_chain: JSON.stringify(harnessChain),
      current_harness: harnessChain[0],
      watchdog_role: watchdog.role || null,
      expected_activity_within_seconds: watchdog.expected_activity_within_seconds
        || defaults.expected_activity_within_seconds || 7200
    });
  }

  const tx = db.transaction(() => {
    if (chart.ceo) seed(chart.ceo, null, 'ceo');
    (chart.directors || []).forEach((d) => seed(d, d.reports_to || 'jarvis', 'director'));
    (chart.agents || []).forEach((a) => seed(a, a.reports_to || null, 'ic'));
  });
  tx();
}
bootstrapOrgChart();

// Prepared statements
const stmts = {
  insertTask: db.prepare(`
    INSERT INTO tasks (title, description, status, priority, agent_id, project_id, sort_order)
    VALUES (@title, @description, @status, @priority, @agent_id, @project_id, @sort_order)
  `),
  getTasksByStatus: db.prepare(`
    SELECT t.*, p.name as project_name, p.color as project_color
    FROM tasks t LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.status = ?
    ORDER BY t.sort_order, t.created_at DESC
  `),
  getTaskById: db.prepare(`
    SELECT t.*, p.name as project_name, p.color as project_color
    FROM tasks t LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.id = ?
  `),
  updateTask: db.prepare(`
    UPDATE tasks SET
      title = @title,
      description = @description,
      status = @status,
      priority = @priority,
      agent_id = @agent_id,
      sort_order = @sort_order,
      updated_at = datetime('now'),
      completed_at = CASE WHEN @status = 'done' THEN datetime('now') ELSE completed_at END
    WHERE id = @id
  `),
  deleteTask: db.prepare('DELETE FROM tasks WHERE id = ?'),
  getAllTasks: db.prepare(`
    SELECT t.*, p.name as project_name, p.color as project_color
    FROM tasks t LEFT JOIN projects p ON t.project_id = p.id
    ORDER BY t.sort_order, t.created_at DESC
  `),
  insertActivity: db.prepare(`
    INSERT INTO activity_log (event_type, agent_id, task_id, project_id, summary, detail_json)
    VALUES (@event_type, @agent_id, @task_id, @project_id, @summary, @detail_json)
  `),
  getRecentActivity: db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?'),
  getLatestRunPerAgent: db.prepare('SELECT agent_id, status, completed_at, started_at, duration_ms, result_text FROM agent_runs WHERE id IN (SELECT MAX(id) FROM agent_runs GROUP BY agent_id)'),
  getRunningAgents: db.prepare('SELECT agent_id FROM agent_runs WHERE status = \'running\''),
  insertRun: db.prepare(`
    INSERT INTO agent_runs (task_id, agent_id, message, status, started_at)
    VALUES (@task_id, @agent_id, @message, 'running', datetime('now'))
  `),
  completeRun: db.prepare(`
    UPDATE agent_runs SET
      status = @status, result_json = @result_json, result_text = @result_text,
      error = @error, duration_ms = @duration_ms, completed_at = datetime('now')
    WHERE id = @id
  `),
  getRunsByTask: db.prepare(`
    SELECT * FROM agent_runs WHERE task_id = ? ORDER BY created_at DESC
  `),
  getRunById: db.prepare(`
    SELECT * FROM agent_runs WHERE id = ?
  `),
  getRecentRuns: db.prepare(`
    SELECT * FROM agent_runs ORDER BY created_at DESC LIMIT ?
  `),

  // Notification statements
  getNotifications: db.prepare(`
    SELECT n.*, ar.agent_id, ar.task_id FROM notifications n
    LEFT JOIN agent_runs ar ON n.agent_run_id = ar.id
    ORDER BY n.created_at DESC LIMIT ?
  `),
  getUnreadCount: db.prepare(`SELECT COUNT(*) as count FROM notifications WHERE read = 0 AND dismissed = 0`),
  insertNotification: db.prepare(`
    INSERT INTO notifications (agent_run_id, type, title, body, action_type, action_data)
    VALUES (@agent_run_id, @type, @title, @body, @action_type, @action_data)
  `),
  markNotificationRead: db.prepare(`UPDATE notifications SET read = 1 WHERE id = ?`),
  dismissNotification: db.prepare(`UPDATE notifications SET dismissed = 1 WHERE id = ?`),
  getNotificationById: db.prepare(`SELECT * FROM notifications WHERE id = ?`),

  // Interview session statements
  insertInterview: db.prepare(`
    INSERT INTO interview_sessions (task_id, messages_json) VALUES (@task_id, @messages_json)
  `),
  getInterviewById: db.prepare(`SELECT * FROM interview_sessions WHERE id = ?`),
  getInterviewByTask: db.prepare(`
    SELECT * FROM interview_sessions WHERE task_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1
  `),
  updateInterview: db.prepare(`
    UPDATE interview_sessions SET
      messages_json = @messages_json, refined_title = @refined_title,
      refined_description = @refined_description, suggested_agent = @suggested_agent,
      status = @status, updated_at = datetime('now')
    WHERE id = @id
  `),

  // Project CRUD statements
  getAllProjects: db.prepare(`SELECT * FROM projects ORDER BY name`),
  getProjectById: db.prepare(`SELECT * FROM projects WHERE id = ?`),
  getProjectsBySpace: db.prepare(`SELECT * FROM projects WHERE space_id = ? ORDER BY name`),
  insertProject: db.prepare(`
    INSERT INTO projects (name, slug, description, color, space_id)
    VALUES (@name, @slug, @description, @color, @space_id)
  `),
  updateProject: db.prepare(`
    UPDATE projects SET name = @name, description = @description, color = @color,
    status = @status, space_id = @space_id, updated_at = datetime('now') WHERE id = @id
  `),
  getTasksByProject: db.prepare(`SELECT * FROM tasks WHERE project_id = ? ORDER BY sort_order, created_at DESC`),
  getTasksByProjectAndStatus: db.prepare(`
    SELECT t.*, p.name as project_name, p.color as project_color
    FROM tasks t LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.project_id = ? AND t.status = ?
    ORDER BY t.sort_order, t.created_at DESC
  `),

  // Space CRUD statements
  getAllSpaces: db.prepare(`
    SELECT s.*, COUNT(p.id) as project_count
    FROM spaces s LEFT JOIN projects p ON p.space_id = s.id
    GROUP BY s.id ORDER BY s.sort_order, s.name
  `),
  getSpaceById: db.prepare(`SELECT * FROM spaces WHERE id = ?`),
  insertSpace: db.prepare(`
    INSERT INTO spaces (name, slug, description, color, sort_order)
    VALUES (@name, @slug, @description, @color, @sort_order)
  `),
  updateSpace: db.prepare(`
    UPDATE spaces SET name = @name, description = @description, color = @color,
    sort_order = @sort_order, updated_at = datetime('now') WHERE id = @id
  `),
  deleteSpace: db.prepare(`DELETE FROM spaces WHERE id = ?`),
  countProjectsInSpace: db.prepare(`SELECT COUNT(*) as count FROM projects WHERE space_id = ?`),
  getRunsByProject: db.prepare(`
    SELECT ar.* FROM agent_runs ar JOIN tasks t ON ar.task_id = t.id
    WHERE t.project_id = ? ORDER BY ar.created_at DESC LIMIT 20
  `),

  // Token/cost statements
  updateRunTokens: db.prepare(`
    UPDATE agent_runs SET input_tokens = @input_tokens, output_tokens = @output_tokens,
    estimated_cost_usd = @estimated_cost_usd WHERE id = @id
  `),
  getLastRunCost: db.prepare(`
    SELECT estimated_cost_usd FROM agent_runs WHERE agent_id = ? AND estimated_cost_usd IS NOT NULL ORDER BY id DESC LIMIT 1
  `),

  // Agent/runtime + settings statements
  upsertAgentRuntime: db.prepare(`
    INSERT INTO agents (id, name, runtime, config_json, updated_at)
    VALUES (@id, @name, @runtime, @config_json, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, runtime = excluded.runtime,
      config_json = excluded.config_json, updated_at = datetime('now')
  `),
  getAgentRuntime: db.prepare('SELECT * FROM agents WHERE id = ?'),
  getAllAgentRuntimes: db.prepare('SELECT * FROM agents ORDER BY id'),

  // Org chart + health + replay buffer statements
  getAgentById: db.prepare('SELECT * FROM agents WHERE id = ?'),
  getAgentsByReportsTo: db.prepare('SELECT * FROM agents WHERE reports_to = ? ORDER BY name'),
  setAgentHarness: db.prepare(`
    UPDATE agents SET current_harness = ?, updated_at = datetime('now') WHERE id = ?
  `),
  setAgentHealth: db.prepare(`
    UPDATE agents SET health_status = ?, last_health_check = datetime('now') WHERE id = ?
  `),
  setAgentActivity: db.prepare(`
    UPDATE agents SET last_activity_at = datetime('now') WHERE id = ?
  `),
  insertAgentMessage: db.prepare(`
    INSERT INTO agent_messages (agent_id, role, content, harness)
    VALUES (@agent_id, @role, @content, @harness)
  `),
  getRecentAgentMessages: db.prepare(`
    SELECT * FROM agent_messages WHERE agent_id = ? ORDER BY id DESC LIMIT ?
  `),
  insertHealthLog: db.prepare(`
    INSERT INTO agent_health_log (agent_id, harness, status, detail)
    VALUES (@agent_id, @harness, @status, @detail)
  `),
  getSettings: db.prepare('SELECT value_json, updated_at FROM settings WHERE key = ?'),
  upsertSettings: db.prepare(`
    INSERT INTO settings (key, value_json, updated_at) VALUES (@key, @value_json, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')
  `),

  // Export/import statements
  exportProjects: db.prepare('SELECT * FROM projects ORDER BY id'),
  exportTasks: db.prepare('SELECT * FROM tasks ORDER BY id'),
  exportAgentRuns: db.prepare('SELECT * FROM agent_runs ORDER BY id'),
  exportNotifications: db.prepare('SELECT * FROM notifications ORDER BY id'),
  exportActivityLog: db.prepare('SELECT * FROM activity_log ORDER BY id'),

  importProject: db.prepare(`
    INSERT OR REPLACE INTO projects (id, name, slug, description, color, status, created_at, updated_at)
    VALUES (@id, @name, @slug, @description, @color, @status, @created_at, @updated_at)
  `),
  importTask: db.prepare(`
    INSERT OR REPLACE INTO tasks (id, project_id, title, description, status, priority, agent_id, created_at, updated_at, completed_at, sort_order)
    VALUES (@id, @project_id, @title, @description, @status, @priority, @agent_id, @created_at, @updated_at, @completed_at, @sort_order)
  `),
  importAgentRun: db.prepare(`
    INSERT OR REPLACE INTO agent_runs (id, task_id, agent_id, session_id, message, status, result_json, result_text, error, delivery_status, duration_ms, started_at, completed_at, created_at, input_tokens, output_tokens, estimated_cost_usd)
    VALUES (@id, @task_id, @agent_id, @session_id, @message, @status, @result_json, @result_text, @error, @delivery_status, @duration_ms, @started_at, @completed_at, @created_at, @input_tokens, @output_tokens, @estimated_cost_usd)
  `),
  importNotification: db.prepare(`
    INSERT OR REPLACE INTO notifications (id, agent_run_id, type, title, body, action_type, action_data, read, dismissed, created_at)
    VALUES (@id, @agent_run_id, @type, @title, @body, @action_type, @action_data, @read, @dismissed, @created_at)
  `),
  importActivityLog: db.prepare(`
    INSERT OR REPLACE INTO activity_log (id, event_type, agent_id, task_id, project_id, summary, detail_json, created_at)
    VALUES (@id, @event_type, @agent_id, @task_id, @project_id, @summary, @detail_json, @created_at)
  `)
};

module.exports = { db, stmts };
