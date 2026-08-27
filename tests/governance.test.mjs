import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { analyzeGovernanceNeed, buildGovernanceWatchlist } = require('../src/governance');

test('governance scanner recommends a workbench for consequential AI/user workflows', () => {
  const project = {
    id: 7,
    name: 'School AI triage pilot',
    slug: 'school-ai-triage-pilot',
    description: 'AI recommendation workflow for teachers, students, and support staff.'
  };
  const tasks = [
    { title: 'Draft rubric for student support recommendations', description: 'Include fairness and privacy review.', status: 'todo', priority: 'high' },
    { title: 'Prototype automated classroom triage', description: 'Teachers need adoption checks.', status: 'review', priority: 'medium' }
  ];

  const analysis = analyzeGovernanceNeed(project, tasks);
  assert.equal(analysis.recommended, true);
  assert.ok(analysis.score >= 7);
  assert.ok(analysis.triggers.some((t) => t.id === 'affected-users'));
  assert.ok(analysis.triggers.some((t) => t.id === 'education'));
  assert.ok(analysis.triggers.some((t) => t.id === 'ai-decisioning'));
  assert.ok(analysis.checklist.length >= 7);
});

test('governance scanner stays quiet for a tiny internal maintenance project', () => {
  const project = { id: 8, name: 'Local CSS cleanup', description: 'Tidy spacing on the dashboard.' };
  const tasks = [{ title: 'Rename a CSS variable', description: 'Small visual cleanup.', status: 'todo' }];
  const analysis = analyzeGovernanceNeed(project, tasks);
  assert.equal(analysis.recommended, false);
  assert.equal(analysis.level, 'low');
});

test('governance watchlist sorts and bounds recommended projects', () => {
  const projects = [
    { id: 1, name: 'Internal polish', description: 'CSS cleanup' },
    { id: 2, name: 'Customer support AI', description: 'Automated recommendations for customers and support staff with privacy risk.' },
    { id: 3, name: 'Education workflow', description: 'EdTech agent for teachers and students.' }
  ];
  const tasksByProject = {
    1: [{ title: 'Small cleanup', status: 'todo' }],
    2: [{ title: 'Build AI scoring rubric', description: 'Trust, policy, customer review', status: 'todo' }],
    3: [{ title: 'Draft classroom assessment model', description: 'Governance and teacher adoption', status: 'todo' }]
  };
  const watchlist = buildGovernanceWatchlist(projects, tasksByProject, 1);
  assert.equal(watchlist.length, 1);
  assert.ok([2, 3].includes(watchlist[0].project_id));
  assert.ok(watchlist[0].triggers.length >= 3);
});
