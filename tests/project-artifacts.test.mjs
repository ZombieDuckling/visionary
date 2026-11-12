// Unit tests for src/project-artifacts.js — the project-level artifact index.
//
// The index exists so an operator can see what a project's agents actually
// produced and whether those files still exist. These tests pin the safety
// posture: recorded paths are untrusted, so escapes, missing workdirs, missing
// files, and symlinks must be reported — never silently followed or assumed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildProjectArtifactIndex } = require('../src/project-artifacts.js');

function makeWorkdir() {
  const root = mkdtempSync(join(tmpdir(), 'visionary-artifacts-'));
  const workdir = join(root, 'demo', 'task-1');
  mkdirSync(join(workdir, 'sub'), { recursive: true });
  writeFileSync(join(workdir, 'report.md'), '# report\n');
  writeFileSync(join(workdir, 'sub', 'notes.md'), 'notes\n');
  return { root, workdir };
}

function run(overrides) {
  return Object.assign({
    run_id: 1,
    task_id: 1,
    task_title: 'Demo task',
    agent_id: 'forge',
    status: 'completed',
    created_at: '2026-11-12 04:00:00',
    workdir: null,
    artifacts_json: '[]'
  }, overrides || {});
}

test('indexes present artifacts and reports recorded-but-missing files', () => {
  const { root, workdir } = makeWorkdir();
  try {
    const index = buildProjectArtifactIndex([
      run({
        run_id: 7,
        workdir,
        artifacts_json: JSON.stringify([
          { path: 'report.md', size: 9, modified_at: '2026-11-12T04:00:00.000Z' },
          { path: 'sub/notes.md', size: 6 },
          { path: 'gone.md', size: 40 }
        ])
      })
    ], { artifact_root: root });

    assert.equal(index.ok, true);
    assert.equal(index.totals.runs_scanned, 1);
    assert.equal(index.totals.runs_with_artifacts, 1);
    assert.equal(index.totals.files_unique, 3);
    assert.equal(index.totals.files_present, 2);
    assert.equal(index.totals.files_missing, 1);
    assert.equal(index.totals.tasks, 1);
    assert.deepEqual(index.totals.agents, ['forge']);
    assert.ok(index.totals.bytes_present > 0);
    assert.ok(index.warnings.some((w) => w.includes('no longer present')));

    const present = index.tasks[0].files.find((f) => f.path === 'report.md');
    assert.equal(present.exists, true);
    assert.equal(present.size, 9);
    assert.equal(present.task_title, 'Demo task');

    const missing = index.tasks[0].files.find((f) => f.path === 'gone.md');
    assert.equal(missing.exists, false);
    assert.equal(missing.reason, 'missing');
    assert.equal(index.missing.length, 1);
    assert.equal(index.missing[0].path, 'gone.md');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('deduplicates artifacts across runs and keeps the newest run as owner', () => {
  const { root, workdir } = makeWorkdir();
  try {
    const index = buildProjectArtifactIndex([
      run({ run_id: 1, created_at: '2026-11-10 04:00:00', workdir, artifacts_json: JSON.stringify([{ path: 'report.md' }]) }),
      run({ run_id: 2, created_at: '2026-11-12 04:00:00', workdir, artifacts_json: JSON.stringify([{ path: 'report.md' }]) })
    ], { artifact_root: root });

    assert.equal(index.totals.files_unique, 1);
    assert.equal(index.totals.files_recorded, 2);
    assert.equal(index.tasks[0].files[0].run_id, 2, 'newest run owns the artifact');
    assert.equal(index.tasks[0].files[0].occurrences, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reports a missing workdir instead of guessing file existence', () => {
  const index = buildProjectArtifactIndex([
    run({
      workdir: '/tmp/visionary-does-not-exist-' + Date.now(),
      artifacts_json: JSON.stringify([{ path: 'report.md' }])
    })
  ]);

  assert.equal(index.totals.files_unique, 1);
  assert.equal(index.totals.files_present, 0);
  assert.equal(index.totals.files_missing, 1);
  assert.equal(index.totals.workdirs_missing, 1);
  assert.equal(index.tasks[0].files[0].reason, 'workdir_missing');
  assert.ok(index.warnings.some((w) => w.includes('missing on disk')));
});

test('rejects artifact paths that escape the run workdir', () => {
  const { root, workdir } = makeWorkdir();
  try {
    writeFileSync(join(root, 'outside.txt'), 'outside\n');
    const index = buildProjectArtifactIndex([
      run({
        workdir,
        artifacts_json: JSON.stringify([
          { path: '../outside.txt' },
          { path: '/etc/hosts' }
        ])
      })
    ], { artifact_root: root });

    assert.equal(index.totals.files_present, 0);
    assert.equal(index.totals.files_missing, 2);
    for (const f of index.tasks[0].files) {
      assert.equal(f.exists, false);
      assert.equal(f.reason, 'escapes_workdir');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reports symlinks without following them', () => {
  const { root, workdir } = makeWorkdir();
  try {
    writeFileSync(join(root, 'target.txt'), 'target contents\n');
    symlinkSync(join(root, 'target.txt'), join(workdir, 'link.txt'));
    const index = buildProjectArtifactIndex([
      run({ workdir, artifacts_json: JSON.stringify([{ path: 'link.txt' }]) })
    ], { artifact_root: root });

    const entry = index.tasks[0].files[0];
    assert.equal(entry.exists, true);
    assert.equal(entry.symlink, true);
    assert.equal(typeof entry.size, 'number', 'symlink size comes from lstat, never the target');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('malformed artifact JSON never throws and yields an empty index', () => {
  const index = buildProjectArtifactIndex([
    run({ artifacts_json: '{not json' }),
    run({ run_id: 2, artifacts_json: JSON.stringify({ nope: true }) }),
    run({ run_id: 3, artifacts_json: JSON.stringify([{ path: '' }, null, { path: 'ok.md' }]) })
  ]);

  assert.equal(index.ok, true);
  assert.equal(index.totals.files_unique, 1);
  assert.equal(index.totals.files_recorded, 1);
});

test('caps the index and says so when a project has more artifacts than the limit', () => {
  const { root, workdir } = makeWorkdir();
  try {
    const files = [];
    for (let i = 0; i < 20; i++) files.push({ path: 'file-' + i + '.txt' });
    const index = buildProjectArtifactIndex([
      run({ workdir, artifacts_json: JSON.stringify(files) })
    ], { artifact_root: root, max_files: 5 });

    assert.equal(index.truncated, true);
    assert.equal(index.totals.files_unique, 20);
    assert.equal(index.totals.files_indexed, 5);
    assert.equal(index.tasks[0].files.length, 5);
    assert.ok(index.warnings.some((w) => w.includes('capped')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
