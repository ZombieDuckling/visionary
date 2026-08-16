#!/usr/bin/env node
// Position-addressed workspace map for Visionary.
//
// This is a deterministic orientation surface for humans and maintenance agents:
// it names the durable places where Visionary stores product context, source
// material, state, review output, and safety boundaries. Keep it small and
// explicit rather than inferring the whole repository every run.

import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const SURFACES = [
  {
    id: 'front-desk',
    label: 'Front desk',
    intent: 'Orientation for humans and agents before editing or operating Visionary.',
    paths: ['README.md', 'HANDOFF.md', 'CLAUDE.md', 'docs/WORKBENCH-CATALOG.md'],
  },
  {
    id: 'org-roles',
    label: 'Org roles and personalities',
    intent: 'Config-as-code role graph and role/personality source files.',
    paths: ['personalities/org-chart.json', 'personalities/agents'],
  },
  {
    id: 'runtime-adapters',
    label: 'Runtime adapters and failover',
    intent: 'Harness boundary where agent work leaves Visionary and CLI/provider behavior is isolated.',
    paths: ['src/runtimes/index.js', 'src/runtimes/failover.js', 'src/runtimes'],
  },
  {
    id: 'durable-state',
    label: 'Durable state',
    intent: 'SQLite schema, prepared statements, events, cleanup, and persisted runtime history.',
    paths: ['db.js', 'sse.js', 'src/cleanup.js'],
  },
  {
    id: 'operator-ui',
    label: 'Operator UI',
    intent: 'No-build vanilla SPA shell, behavior, styles, and installable PWA cache.',
    paths: ['public/index.html', 'public/app.js', 'public/styles.css', 'public/sw.js'],
  },
  {
    id: 'automation',
    label: 'Automation and scheduled work',
    intent: 'Cron parsing, watchdog process, bridge, and deterministic helper scripts.',
    paths: ['docs/AUTOMATION-TIMING-RUBRIC.md', 'src/scheduler.js', 'watchdog.py', 'bridge.py', 'scripts'],
  },
  {
    id: 'review-surface',
    label: 'Review and verification surface',
    intent: 'Tests, smoke checks, production-readiness heuristics, and review verdict parsing.',
    paths: ['tests', 'src/production-readiness.js', 'src/review-verdict.js'],
  },
  {
    id: 'boundary-layer',
    label: 'Boundary layer',
    intent: 'Local-first, guardrail, secret/cost/retention, and connector-scope controls.',
    paths: ['src/guardrails.js', 'src/mcp.js', 'README.md'],
  },
];

function describePath(pathname) {
  const absolute = join(repoRoot, pathname);
  return {
    path: pathname,
    exists: existsSync(absolute),
  };
}

export function buildWorkspaceMap() {
  const surfaces = SURFACES.map((surface) => ({
    ...surface,
    paths: surface.paths.map(describePath),
  }));

  const missing = surfaces.flatMap((surface) =>
    surface.paths
      .filter((entry) => !entry.exists)
      .map((entry) => ({ surface: surface.id, path: entry.path }))
  );

  return {
    generated_by: relative(repoRoot, fileURLToPath(import.meta.url)),
    repo_root: repoRoot,
    principle: 'Position-addressed memory: use paths, manifests, and review surfaces as model-readable context before adding heavier retrieval.',
    surfaces,
    missing,
  };
}

function printHuman(map) {
  console.log('Visionary workspace map');
  console.log(`repo: ${map.repo_root}`);
  console.log(`principle: ${map.principle}`);
  console.log('');
  for (const surface of map.surfaces) {
    console.log(`${surface.label} (${surface.id})`);
    console.log(`  ${surface.intent}`);
    for (const entry of surface.paths) {
      console.log(`  ${entry.exists ? '✓' : '✗'} ${entry.path}`);
    }
    console.log('');
  }
  if (map.missing.length) {
    console.error(`Missing mapped paths: ${map.missing.map((m) => m.path).join(', ')}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const map = buildWorkspaceMap();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(map, null, 2));
  } else {
    printHuman(map);
  }
  if (map.missing.length) process.exitCode = 1;
}
