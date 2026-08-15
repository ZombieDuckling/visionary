import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildWorkspaceMap } from '../scripts/workspace-map.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

test('workspace map catalogs the position-addressed workbench surfaces', () => {
  const map = buildWorkspaceMap();

  assert.equal(map.repo_root, repoRoot);
  assert.match(map.principle, /Position-addressed memory/i);
  assert.deepEqual(map.missing, []);

  const ids = map.surfaces.map((surface) => surface.id);
  for (const required of [
    'front-desk',
    'org-roles',
    'runtime-adapters',
    'durable-state',
    'operator-ui',
    'automation',
    'review-surface',
    'boundary-layer',
  ]) {
    assert.ok(ids.includes(required), `workspace map includes ${required}`);
  }

  const frontDesk = map.surfaces.find((surface) => surface.id === 'front-desk');
  assert.ok(frontDesk.paths.some((entry) => entry.path === 'README.md' && entry.exists));
  assert.ok(frontDesk.paths.some((entry) => entry.path === 'docs/WORKBENCH-CATALOG.md' && entry.exists));
});

test('workspace map CLI emits valid JSON and fails on missing mapped paths', () => {
  const result = spawnSync(process.execPath, ['scripts/workspace-map.mjs', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.repo_root, repoRoot);
  assert.deepEqual(parsed.missing, []);
});
