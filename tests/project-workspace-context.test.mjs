// Unit tests for src/project-workspace-context.js — the bounded, disk-verified
// project workspace block injected into dispatch.
//
// These pin the properties that make the block trustworthy: only files that
// actually exist are listed, paths are relative to the workspace root so a
// fresh agent can navigate them, recorded-but-gone files are counted rather
// than asserted, a missing workdir is reported, the block stays inside its
// character budget by dropping whole tasks, and no verified file means no
// block at all (a header alone is noise).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildProjectWorkspaceContext,
  renderProjectWorkspacePromptBlock,
  workspaceRootFromRuns
} = require('../src/project-workspace-context.js');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'visionary-workspace-'));
  const workspace = join(root, 'launch-brief');
  const task1 = join(workspace, 'task-1');
  const task2 = join(workspace, 'task-2');
  mkdirSync(task1, { recursive: true });
  mkdirSync(task2, { recursive: true });
  writeFileSync(join(task1, 'report.md'), '# report\n');
  writeFileSync(join(task1, 'spec.md'), '# spec\n');
  writeFileSync(join(task2, 'schema.sql'), 'create table t(id);\n');
  return { root, workspace, task1, task2 };
}

function run(overrides) {
  return Object.assign({
    run_id: 10,
    task_id: 1,
    task_title: 'Draft dashboard',
    agent_id: 'coder',
    status: 'completed',
    workdir: '/tmp/visionary/launch-brief/task-1',
    artifacts_json: '[]',
    created_at: '2026-11-16 04:00:00'
  }, overrides || {});
}

test('lists only verified files, grouped by task, with workspace-relative paths', () => {
  const fx = fixture();
  try {
    const context = buildProjectWorkspaceContext({
      project: { id: 3, name: 'Launch brief', slug: 'launch-brief' },
      runs: [
        run({
          workdir: fx.task1,
          artifacts_json: JSON.stringify([{ path: 'report.md' }, { path: 'spec.md' }, { path: 'gone.md' }])
        }),
        run({
          run_id: 9,
          task_id: 2,
          task_title: 'Schema',
          agent_id: 'forge',
          workdir: fx.task2,
          artifacts_json: JSON.stringify([{ path: 'schema.sql' }]),
          created_at: '2026-11-14 04:00:00'
        })
      ]
    });

    assert.equal(context.ok, true);
    assert.equal(context.workspace_root, fx.workspace);
    assert.equal(context.tasks.length, 2);
    assert.deepEqual(context.tasks.map((t) => t.task_id), [1, 2], 'newest task first');
    assert.deepEqual(context.tasks[0].files.map((f) => f.path), ['task-1/report.md', 'task-1/spec.md']);
    assert.equal(context.tasks[0].files_missing, 1);
    assert.equal(context.totals.files_present, 3);
    assert.equal(context.totals.files_missing, 1);
    assert.ok(context.warnings.some((w) => /no longer present/.test(w)), 'missing files are disclosed');
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('a missing workdir yields no files for that task and is reported', () => {
  const fx = fixture();
  try {
    const context = buildProjectWorkspaceContext({
      project: { id: 3, name: 'Launch brief' },
      runs: [
        run({ workdir: join(fx.workspace, 'task-404'), artifacts_json: JSON.stringify([{ path: 'a.md' }]) }),
        run({ run_id: 9, task_id: 2, workdir: fx.task2, artifacts_json: JSON.stringify([{ path: 'schema.sql' }]) })
      ]
    });
    assert.equal(context.tasks.length, 1, 'only the task with a live workdir is listed');
    assert.equal(context.tasks[0].task_id, 2);
    assert.equal(context.totals.files_missing, 1);
    assert.equal(context.totals.workdirs_missing, 1);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('artifact paths that escape the workdir are rejected', () => {
  const fx = fixture();
  try {
    const context = buildProjectWorkspaceContext({
      project: { id: 3, name: 'Launch brief' },
      runs: [run({
        workdir: fx.task1,
        artifacts_json: JSON.stringify([{ path: '../task-2/schema.sql' }, { path: 'report.md' }])
      })]
    });
    assert.equal(context.totals.files_present, 1);
    assert.equal(context.totals.files_missing, 1, 'escaping path counted as not verifiable');
    assert.deepEqual(context.tasks[0].files.map((f) => f.path), ['task-1/report.md']);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('render returns null when no file was verified', () => {
  const block = renderProjectWorkspacePromptBlock(buildProjectWorkspaceContext({
    project: { id: 3, name: 'Empty' },
    runs: []
  }));
  assert.equal(block, null);
});

test('render lists files, flags a failed run, and discloses missing files', () => {
  const fx = fixture();
  try {
    const context = buildProjectWorkspaceContext({
      project: { id: 3, name: 'Launch brief' },
      runs: [run({
        workdir: fx.task1,
        status: 'failed',
        artifacts_json: JSON.stringify([{ path: 'report.md' }, { path: 'gone.md' }])
      })]
    });
    const block = renderProjectWorkspacePromptBlock(context);
    assert.ok(block, 'block rendered');
    assert.ok(block.text.includes('[PROJECT WORKSPACE'));
    assert.ok(block.text.includes('task-1/report.md'));
    assert.ok(!block.text.includes('gone.md'), 'missing file is not listed as if it existed');
    assert.ok(/run failed — files may be partial/.test(block.text));
    assert.ok(/1 recorded file\(s\) are no longer on disk/.test(block.text));
    assert.equal(block.files_listed, 1);
    assert.deepEqual(block.task_ids, [1]);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('budget drops whole tasks and reports the drop count', () => {
  const fx = fixture();
  try {
    const runs = [];
    for (let i = 1; i <= 5; i += 1) {
      const dir = join(fx.workspace, 'task-' + i);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'a-very-long-artifact-name-' + i + '.md'), 'x');
      runs.push(run({
        run_id: i,
        task_id: i,
        task_title: 'Task number ' + i,
        workdir: dir,
        artifacts_json: JSON.stringify([{ path: 'a-very-long-artifact-name-' + i + '.md' }]),
        created_at: '2026-11-' + String(10 + i).padStart(2, '0') + ' 04:00:00'
      }));
    }
    const context = buildProjectWorkspaceContext({ project: { id: 3, name: 'Launch brief' }, runs });
    const block = renderProjectWorkspacePromptBlock(context, { max_chars: 420 });
    assert.ok(block, 'first task still lands');
    assert.equal(block.count, 1);
    assert.equal(block.dropped, 4);
    assert.ok(block.chars < 600, 'block stays near the budget');
    assert.ok(block.text.includes('task #5'), 'newest task is the one kept');
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('task cap drops tasks beyond max_tasks', () => {
  const fx = fixture();
  try {
    const runs = [];
    for (let i = 1; i <= 4; i += 1) {
      const dir = join(fx.workspace, 'task-' + i);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'f' + i + '.md'), 'x');
      runs.push(run({
        run_id: i,
        task_id: i,
        workdir: dir,
        artifacts_json: JSON.stringify([{ path: 'f' + i + '.md' }]),
        created_at: '2026-11-' + String(10 + i).padStart(2, '0') + ' 04:00:00'
      }));
    }
    const context = buildProjectWorkspaceContext({ project: { id: 3, name: 'Launch brief' }, runs });
    const block = renderProjectWorkspacePromptBlock(context, { max_tasks: 2, max_chars: 5000 });
    assert.equal(block.count, 2);
    assert.equal(block.dropped, 2);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('workspace root comes from recorded workdirs, not the project slug', () => {
  const root = workspaceRootFromRuns([
    { workdir: '/tmp/visionary/joshs-site/task-4' },
    { workdir: '/tmp/visionary/other/task-1' }
  ]);
  assert.equal(root, '/tmp/visionary/joshs-site');
  assert.equal(workspaceRootFromRuns([]), null);
});

test('output is deterministic for identical input', () => {
  const fx = fixture();
  try {
    const input = {
      project: { id: 3, name: 'Launch brief' },
      runs: [run({
        workdir: fx.task1,
        artifacts_json: JSON.stringify([{ path: 'spec.md' }, { path: 'report.md' }])
      })]
    };
    const a = renderProjectWorkspacePromptBlock(buildProjectWorkspaceContext(input));
    const b = renderProjectWorkspacePromptBlock(buildProjectWorkspaceContext(input));
    assert.equal(a.text, b.text);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});
