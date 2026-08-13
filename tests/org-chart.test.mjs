import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateOrgChart } from '../scripts/validate-org-chart.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function loadChart() {
  return JSON.parse(readFileSync(resolve(repoRoot, 'personalities/org-chart.json'), 'utf8'));
}

test('org chart config references real personality files and coherent reporting lines', () => {
  const result = validateOrgChart(loadChart(), { repoRoot });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.counts.ceo, 1);
  assert.equal(result.counts.directors, 4);
  assert.equal(result.counts.agents, 11);
  assert.equal(result.counts.total, 16);
});

test('org chart validator rejects drift between director membership and agent reporting line', () => {
  const chart = loadChart();
  chart.agents = chart.agents.map((agent) => (
    agent.id === 'coder' ? { ...agent, reports_to: 'director-intelligence' } : agent
  ));

  const result = validateOrgChart(chart, { repoRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('director-engineering: member coder reports_to is director-intelligence')));
});

test('org chart validator rejects missing personality files before boot-time surprises', () => {
  const chart = loadChart();
  chart.agents = chart.agents.map((agent) => (
    agent.id === 'scout' ? { ...agent, personality_path: 'personalities/agents/missing-scout.md' } : agent
  ));

  const result = validateOrgChart(chart, { repoRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('scout: personality file missing')));
});
