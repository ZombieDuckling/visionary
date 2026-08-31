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
  assert.ok(analysis.workbench_profiles.some((p) => p.id === 'domain_ai_literacy'));
  assert.match(analysis.next_action, /domain-literacy/);
  assert.ok(analysis.checklist.length >= 7);
});

test('governance scanner identifies domain AI literacy workbench shape outside schools', () => {
  const project = {
    id: 9,
    name: 'Claims team AI literacy rollout',
    slug: 'claims-team-ai-literacy-rollout',
    description: 'Enablement workshop for insurance practitioners adopting AI assistants in the support workflow.'
  };
  const tasks = [
    { title: 'Collect practitioner examples and anti-examples', description: 'Compare human-only decisions with assist-only AI drafting.', status: 'todo', priority: 'high' },
    { title: 'Design peer review loop', description: 'Community of practice captures trust objections and consent boundaries.', status: 'todo', priority: 'medium' }
  ];

  const analysis = analyzeGovernanceNeed(project, tasks);
  assert.equal(analysis.recommended, true);
  assert.ok(analysis.triggers.some((t) => t.id === 'domain-literacy'));
  const profile = analysis.workbench_profiles.find((p) => p.id === 'domain_ai_literacy');
  assert.ok(profile);
  assert.ok(profile.checklist.some((item) => /use cases, assist-only cases/.test(item)));
});

test('governance scanner exposes post-digital governance surface for sensitive AI workflows', () => {
  const project = {
    id: 10,
    name: 'Customer security agent',
    slug: 'customer-security-agent',
    description: 'External customer AI agent for cyber risk triage, account access recommendations, and privacy-sensitive incident notes.'
  };
  const tasks = [
    { title: 'Prototype automated access recommendation', description: 'Map identity, action rights, logs, rollback path, and provider dependency before launch.', status: 'todo', priority: 'high' }
  ];

  const analysis = analyzeGovernanceNeed(project, tasks);
  assert.equal(analysis.recommended, true);
  assert.ok(analysis.triggers.some((t) => t.id === 'sensitive-domain'));
  assert.ok(analysis.triggers.some((t) => t.id === 'ai-decisioning'));
  const profile = analysis.workbench_profiles.find((p) => p.id === 'post_digital_governance_surface');
  assert.ok(profile);
  assert.match(profile.reason, /identity, access, money, reputation, security posture/);
  assert.ok(profile.checklist.some((item) => /read, edit, execute, export, delete/.test(item)));
  assert.match(analysis.next_action, /governance-surface/);
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
  assert.ok(Array.isArray(watchlist[0].workbench_profiles));
});
