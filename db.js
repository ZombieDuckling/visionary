const Database = require('better-sqlite3');
const db = new Database('./visionary.sqlite');

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
  insertProject: db.prepare(`
    INSERT INTO projects (name, slug, description, color) VALUES (@name, @slug, @description, @color)
  `),
  updateProject: db.prepare(`
    UPDATE projects SET name = @name, description = @description, color = @color,
    status = @status, updated_at = datetime('now') WHERE id = @id
  `),
  getTasksByProject: db.prepare(`SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC`),
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
  `)
};

module.exports = { db, stmts };
