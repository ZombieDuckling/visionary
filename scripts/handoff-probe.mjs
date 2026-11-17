import { createRequire } from 'node:module';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';

process.env.VISIONARY_DB = '/tmp/visionary-handoff-probe.sqlite';
for (const suffix of ['', '-wal', '-shm']) { try { rmSync(process.env.VISIONARY_DB + suffix); } catch {} }

const require = createRequire(import.meta.url);
const root = '/Users/joshuasack/Projects/visionary';
const db = require(root + '/db.js');
const { buildProjectHandoff } = require(root + '/src/project-handoff.js');
const { buildDecisionLedger } = require(root + '/src/decision-ledger.js');
const { buildProjectArtifactIndex } = require(root + '/src/project-artifacts.js');
const stmts = db.stmts;

const pid = stmts.insertProject.run({ name: 'Probe project', slug: 'probe', description: 'Handoff probe', color: null, space_id: null }).lastInsertRowid;
const t1 = stmts.insertTask.run({ title: 'Review pricing copy', description: '', status: 'review', priority: 'high', agent_id: 'argus', project_id: pid, sort_order: 0 }).lastInsertRowid;
const t2 = stmts.insertTask.run({ title: 'Build export', description: '', status: 'todo', priority: 'medium', agent_id: null, project_id: pid, sort_order: 1 }).lastInsertRowid;
const workdir = '/tmp/visionary-handoff-workdir/task-' + t1;
mkdirSync(workdir, { recursive: true });
writeFileSync(workdir + '/report.md', '# report\n');
const rid = stmts.insertRun.run({ task_id: t1, agent_id: 'coder', message: 'probe' }).lastInsertRowid;
db.db.prepare(`UPDATE agent_runs SET status = 'failed', error = ?, workdir = ?, artifacts_json = ?, completed_at = datetime('now') WHERE id = ?`)
  .run('quota exceeded on claude', workdir, JSON.stringify([{ path: 'report.md' }, { path: 'gone.md' }]), rid);
db.db.prepare(`INSERT INTO decisions (project_id, title, decision, rationale, status, decided_by, decided_at) VALUES (?, ?, ?, ?, 'accepted', 'Josh', '2026-01-01')`)
  .run(pid, 'Use SQLite only', 'No second database', 'Local-first and one-file backup');

const brief = buildProjectHandoff({
  project: stmts.getProjectById.get(pid),
  tasks: stmts.getTasksByProject.all(pid),
  runs: stmts.getRunsByProject.all(pid),
  ledger: buildDecisionLedger(stmts.getDecisionsByProject.all(pid, 500)),
  artifacts: buildProjectArtifactIndex(stmts.getArtifactRunsByProject.all(pid), { artifact_root: '/tmp' }),
  now: '2026-11-17T02:45:00.000Z'
});
console.log(brief.markdown);
console.log('\n--- JSON keys ---');
console.log(Object.keys(brief).join(', '));
console.log('start_here:', JSON.stringify(brief.start_here));
