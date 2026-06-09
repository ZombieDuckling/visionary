"""Migration runner — mirrors db.js's append-only array.

Add new migrations at the END of MIGRATIONS. Never edit or reorder a shipped
entry.
"""

from visionary.db.database import Database

# Each entry is (version: int, sql: str).
# IMPORTANT: append-only. Do not edit or reorder shipped entries.
# Migrations 1-7 are transcribed verbatim from db.js.
MIGRATIONS: list[tuple[int, str]] = [
    # Migration 0 -> 1: Create all 5 tables with CHECK constraints and indexes
    (
        1,
        """
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
    status TEXT DEFAULT 'pending'
      CHECK(status IN ('pending','running','completed','failed','timeout')),
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
  """,
    ),
    # Migration 1 -> 2: Interview sessions, token columns, project indexes
    (
        2,
        """
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
  """,
    ),
    # Migration 2 -> 3: Runtime registry metadata + operator settings
    (
        3,
        """
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
  """,
    ),
    # Migration 3 -> 4: Spaces (workspaces) for grouping projects
    (
        4,
        """
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
  """,
    ),
    # Migration 4 -> 5: Org-chart fields on agents + conversation replay buffer
    (
        5,
        """
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
  """,
    ),
    # Migration 5 -> 6: Scheduler — cron-style scheduled agent runs
    (
        6,
        """
  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    name TEXT NOT NULL,
    cron TEXT NOT NULL,
    prompt TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at TEXT,
    last_status TEXT,
    last_detail TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_schedules_enabled ON schedules(enabled);
  CREATE INDEX idx_schedules_agent ON schedules(agent_id);
  """,
    ),
    # Migration 6 -> 7: Watchdog nudge — persist last_nudge_at so cooldown survives restart
    (
        7,
        """
  ALTER TABLE agents ADD COLUMN last_nudge_at TEXT;
  INSERT OR IGNORE INTO settings (key, value_json)
  VALUES ('watchdog', '{"auto_nudge_enabled":false,"nudge_cooldown_seconds":900}');
  """,
    ),
    # Migration 7 -> 8: Comm fabric — agent_mailbox + blackboard + activity_log.trace_id
    (
        8,
        """
        CREATE TABLE agent_mailbox (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            to_agent_id   TEXT NOT NULL,
            from_agent_id TEXT,
            subject       TEXT NOT NULL,
            body_json     TEXT NOT NULL,
            priority      INTEGER NOT NULL DEFAULT 0,
            status        TEXT NOT NULL DEFAULT 'pending',
            thread_id     TEXT,
            reply_to      INTEGER REFERENCES agent_mailbox(id),
            trace_id      TEXT,
            created_at    TEXT NOT NULL DEFAULT (datetime('now')),
            read_at       TEXT,
            processed_at  TEXT,
            FOREIGN KEY (to_agent_id) REFERENCES agents(id)
        );
        CREATE INDEX idx_mailbox_to_status ON agent_mailbox(to_agent_id, status);
        CREATE INDEX idx_mailbox_thread    ON agent_mailbox(thread_id);
        CREATE INDEX idx_mailbox_trace     ON agent_mailbox(trace_id);

        CREATE TABLE blackboard (
            key         TEXT PRIMARY KEY,
            value_json  TEXT NOT NULL,
            updated_by  TEXT,
            updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
            version     INTEGER NOT NULL DEFAULT 1
        );

        ALTER TABLE activity_log ADD COLUMN trace_id TEXT;
        CREATE INDEX idx_activity_trace ON activity_log(trace_id);
        """,
    ),
]


# Bootstrap SQL — mirrors db.js exactly: a single implicit-rowid row at
# rowid=1 holds the current version.  INSERT OR IGNORE is idempotent because
# the rowid constraint prevents a second row from being inserted, so the
# existing version is always preserved across repeated bootstrap calls.
_BOOTSTRAP = """
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO schema_version (rowid, version) VALUES (1, 0);
"""


def _current_version(db: Database) -> int:
    """Ensure schema_version exists and return the current version integer."""
    db.executescript(_BOOTSTRAP)
    row = db.query_one("SELECT version FROM schema_version WHERE rowid = 1")
    return row["version"] if row else 0


def _run_atomic(db: Database, version: int, sql: str) -> None:
    """Execute *sql* plus a version bump atomically using a SAVEPOINT.

    Why not executescript() + BEGIN/COMMIT?
    Python's sqlite3.executescript() issues an implicit COMMIT before running,
    so wrapping it in db.transaction() raises "cannot commit — no transaction
    is active".  Using BEGIN inside the script doesn't help either: if a
    statement raises a syntax error mid-script, SQLite has already executed
    (and auto-committed) the statements that came before the error.

    SAVEPOINT is the correct primitive: it wraps DDL *and* DML in a single
    undoable unit.  ROLLBACK TO releases all changes made since the savepoint,
    and RELEASE finalises them.  SQLite DDL is fully transactional, so this
    gives true all-or-nothing semantics.
    """
    sp_name = f"migration_{version}"
    with db.savepoint(sp_name):
        stmts = [s.strip() for s in sql.split(";") if s.strip()]
        for stmt in stmts:
            db.execute(stmt)
        db.execute(
            "UPDATE schema_version SET version = ? WHERE rowid = 1", [version]
        )


def run_migrations(db: Database) -> int:
    """Apply unapplied migrations in order. Returns the final schema version."""
    current = _current_version(db)
    for version, sql in MIGRATIONS:
        if version <= current:
            continue
        _run_atomic(db, version, sql)
        current = version
    return current
