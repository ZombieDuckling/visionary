import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  readAgentCharter,
  dispatchFileId,
  splitFrontmatter,
  parseFrontmatter,
  listSections
} = require('../src/agent-charter.js');

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'visionary-charter-'));
  const dir = join(root, 'personalities', 'agents');
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return { root, dir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const VALID = `---
agent_id: forge
name: Forge
title: Builder, scaffolds projects
reports_to: director-engineering
expected_activity_within_seconds: 7200
---

# Forge

You are **Forge**: Builder, scaffolds projects.

## Lane
Build things.

## Failover
Same personality on any harness.
`;

test('reads the charter dispatch would inject and reports it as verified', () => {
  const f = fixture({ 'forge.md': VALID });
  try {
    const charter = readAgentCharter({
      agentId: 'forge',
      personalityDir: f.dir,
      repoRoot: f.root,
      configuredPath: 'personalities/agents/forge.md',
      orgNode: { id: 'forge', name: 'Forge', title: 'Builder, scaffolds projects', role: 'builder', reports_to: 'director-engineering' }
    });
    assert.equal(charter.status, 'ok');
    assert.equal(charter.injected_in_dispatch, true);
    assert.equal(charter.exists, true);
    assert.equal(charter.frontmatter.agent_id, 'forge');
    assert.equal(charter.frontmatter.reports_to, 'director-engineering');
    assert.equal(charter.expected_activity_within_seconds, 7200);
    assert.deepEqual(charter.sections, ['Lane', 'Failover']);
    assert.match(charter.body, /You are \*\*Forge\*\*/);
    assert.deepEqual(charter.warnings, []);
    assert.equal(charter.dispatch_path, 'personalities/agents/forge.md');
  } finally {
    f.cleanup();
  }
});

test('missing charter is reported missing and not injected', () => {
  const f = fixture({});
  try {
    const charter = readAgentCharter({
      agentId: 'ghost',
      personalityDir: f.dir,
      repoRoot: f.root,
      configuredPath: 'personalities/agents/ghost.md',
      orgNode: { id: 'ghost', reports_to: 'argus' }
    });
    assert.equal(charter.status, 'missing');
    assert.equal(charter.injected_in_dispatch, false);
    assert.equal(charter.body, '');
    assert.ok(charter.warnings.some((w) => w.code === 'charter_missing'));
    assert.ok(charter.warnings.some((w) => w.code === 'config_path_missing'));
  } finally {
    f.cleanup();
  }
});

test('agent_id mismatch is flagged as a mismatch, not a clean charter', () => {
  const f = fixture({ 'scout.md': VALID.replace('agent_id: forge', 'agent_id: analyst') });
  try {
    const charter = readAgentCharter({ agentId: 'scout', personalityDir: f.dir, repoRoot: f.root });
    assert.equal(charter.status, 'mismatch');
    assert.ok(charter.warnings.some((w) => w.code === 'agent_id_mismatch'));
  } finally {
    f.cleanup();
  }
});

test('legacy jarvis/main ids resolve to the argus charter', () => {
  assert.equal(dispatchFileId('jarvis'), 'argus');
  assert.equal(dispatchFileId('main'), 'argus');
  assert.equal(dispatchFileId('forge'), 'forge');

  const f = fixture({ 'argus.md': VALID.replace(/forge/g, 'argus').replace('director-engineering', 'operator') });
  try {
    const charter = readAgentCharter({ agentId: 'jarvis', personalityDir: f.dir, repoRoot: f.root });
    assert.equal(charter.status, 'ok');
    assert.equal(charter.file_id, 'argus');
    assert.equal(charter.dispatch_path, 'personalities/agents/argus.md');
  } finally {
    f.cleanup();
  }
});

test('org-chart path drift is surfaced because dispatch loads by agent id', () => {
  const f = fixture({ 'forge.md': VALID, 'builder.md': VALID });
  try {
    const charter = readAgentCharter({
      agentId: 'forge',
      personalityDir: f.dir,
      repoRoot: f.root,
      configuredPath: 'personalities/agents/builder.md'
    });
    assert.equal(charter.status, 'ok');
    assert.ok(charter.warnings.some((w) => w.code === 'config_path_drift'));
  } finally {
    f.cleanup();
  }
});

test('org chart metadata drift (reports_to, title, name) is reported', () => {
  const f = fixture({ 'forge.md': VALID });
  try {
    const charter = readAgentCharter({
      agentId: 'forge',
      personalityDir: f.dir,
      repoRoot: f.root,
      orgNode: { id: 'forge', name: 'Forge Prime', title: 'Something else', reports_to: 'director-operations' }
    });
    const codes = charter.warnings.map((w) => w.code);
    assert.ok(codes.includes('reports_to_mismatch'));
    assert.ok(codes.includes('title_mismatch'));
    assert.ok(codes.includes('name_mismatch'));
  } finally {
    f.cleanup();
  }
});

test('charter without frontmatter is still readable but flagged', () => {
  const f = fixture({ 'forge.md': '# Forge\n\nJust a body, no frontmatter.\n' });
  try {
    const charter = readAgentCharter({ agentId: 'forge', personalityDir: f.dir, repoRoot: f.root });
    assert.equal(charter.status, 'ok');
    assert.ok(charter.warnings.some((w) => w.code === 'no_frontmatter'));
  } finally {
    f.cleanup();
  }
});

test('empty charter body is not treated as an injected charter', () => {
  const f = fixture({ 'forge.md': '---\nagent_id: forge\n---\n\n' });
  try {
    const charter = readAgentCharter({ agentId: 'forge', personalityDir: f.dir, repoRoot: f.root });
    assert.equal(charter.status, 'empty');
    assert.equal(charter.injected_in_dispatch, false);
    assert.ok(charter.warnings.some((w) => w.code === 'empty_body'));
  } finally {
    f.cleanup();
  }
});

test('charter longer than the dispatch cap is truncated and disclosed', () => {
  const f = fixture({ 'forge.md': VALID + '\n' + 'x'.repeat(200) + '\n' });
  try {
    const charter = readAgentCharter({ agentId: 'forge', personalityDir: f.dir, repoRoot: f.root, maxChars: 80 });
    assert.equal(charter.truncated, true);
    assert.match(charter.body, /\[charter truncated\]$/);
    assert.ok(charter.warnings.some((w) => w.code === 'charter_truncated'));
    assert.equal(charter.char_count > 80, true);
  } finally {
    f.cleanup();
  }
});

test('missing agent id and missing directory are reported, not thrown', () => {
  const noId = readAgentCharter({ agentId: '', personalityDir: '/tmp' });
  assert.equal(noId.status, 'missing');
  assert.ok(noId.warnings.some((w) => w.code === 'missing_agent_id'));

  const noDir = readAgentCharter({ agentId: 'forge', personalityDir: null });
  assert.equal(noDir.status, 'unreadable');
  assert.ok(noDir.warnings.some((w) => w.code === 'missing_personality_dir'));
});

test('charter still naming the retired jarvis identity is flagged', () => {
  const f = fixture({ 'forge.md': VALID + '\nEscalate to Jarvis when blocked.\n' });
  try {
    const charter = readAgentCharter({ agentId: 'forge', personalityDir: f.dir, repoRoot: f.root });
    assert.ok(charter.warnings.some((w) => w.code === 'retired_identity'));
  } finally {
    f.cleanup();
  }
});

test('director formal names agree with the org chart pod label', () => {
  const f = fixture({
    'director-intelligence.md': '---\nagent_id: director-intelligence\nname: Director of Intelligence\nreports_to: argus\n---\n\n# Director\n\nBody.\n'
  });
  try {
    const charter = readAgentCharter({
      agentId: 'director-intelligence',
      personalityDir: f.dir,
      repoRoot: f.root,
      orgNode: { id: 'director-intelligence', name: 'Intelligence', reports_to: 'argus' }
    });
    assert.equal(charter.status, 'ok');
    assert.ok(!charter.warnings.some((w) => w.code === 'name_mismatch'));
  } finally {
    f.cleanup();
  }
});

test('frontmatter parsing handles arrays and quoted values', () => {
  const split = splitFrontmatter('---\nagent_id: "forge"\nharness_chain: [openclaw, claude-code]\n---\n# Body\n');
  assert.equal(split.present, true);
  const fields = parseFrontmatter(split.block);
  assert.equal(fields.agent_id, 'forge');
  assert.deepEqual(fields.harness_chain, ['openclaw', 'claude-code']);
  assert.equal(split.body, '# Body');
  assert.deepEqual(listSections('# Body\n## Lane\n## Escalation'), ['Lane', 'Escalation']);
});
