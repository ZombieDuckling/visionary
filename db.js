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
  getRunningAgents: db.prepare('SELECT agent_id FROM agent_runs WHERE status = \'running\'')
};

module.exports = { db, stmts };
