// Unit tests for src/artifact-secret-scan.js — the deterministic credential
// scan recorded on a completed run's artifacts.
//
// These pin the properties that make the scan trustworthy: it finds the
// high-confidence credential shapes that actually leak, it never reproduces the
// matched secret in its output, it reports skipped files with a reason instead
// of silently passing them, it refuses paths outside the workdir, it discloses
// its caps, and it is deterministic for a fixed workspace.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { scanArtifacts } = require('../src/artifact-secret-scan.js');

const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';
const GITHUB_TOKEN = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
const OPENAI_KEY = 'sk-' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2W3x4';
const GOOGLE_KEY = 'AIza' + 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q';
const SLACK_TOKEN = 'xoxb-123456789012-abcdefghijkl';
const STRIPE_KEY = 'sk_live_' + 'a1B2c3D4e5F6g7H8i9J0k1L2';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop';
const DB_URL = 'postgres://app_user:hunter2pass@db.example.com:5432/app';
const PEM = '-----BEGIN RSA PRIVATE KEY-----';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'visionary-secret-scan-'));
  const workdir = join(root, 'task-1');
  mkdirSync(workdir, { recursive: true });
  return { root, workdir };
}

function artifactsOf(paths) {
  return paths.map((p) => ({ path: p }));
}

test('detects high-confidence credential shapes in artifacts', () => {
  const fx = fixture();
  try {
    writeFileSync(join(fx.workdir, 'leak.md'), [
      '# deploy notes',
      'aws key ' + AWS_KEY,
      'github ' + GITHUB_TOKEN,
      'openai ' + OPENAI_KEY,
      'google ' + GOOGLE_KEY,
      'slack ' + SLACK_TOKEN,
      'stripe ' + STRIPE_KEY,
      'db ' + DB_URL,
      'key file:',
      PEM
    ].join('\n'));

    const result = scanArtifacts({
      workdir: fx.workdir,
      artifacts: artifactsOf(['leak.md'])
    });

    const rules = new Set(result.findings.map((f) => f.rule));
    for (const expected of [
      'aws_access_key_id', 'github_token', 'openai_key', 'google_api_key',
      'slack_token', 'stripe_live_key', 'db_url_password', 'private_key_block'
    ]) {
      assert.ok(rules.has(expected), 'expected rule ' + expected + ' to fire');
    }
    assert.equal(result.counts.files, 1);
    assert.equal(result.counts.findings, result.findings.length);
    assert.ok(result.counts.high >= 8, 'high-severity findings counted');
    const aws = result.findings.find((f) => f.rule === 'aws_access_key_id');
    assert.equal(aws.line, 2, 'line number points at the matching line');
    assert.equal(aws.preview, 'AKIA…', 'preview is a prefix only');
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('never reproduces the matched secret in its output', () => {
  const fx = fixture();
  try {
    writeFileSync(join(fx.workdir, 'leak.env'), [
      'AWS_ACCESS_KEY_ID=' + AWS_KEY,
      'GITHUB_TOKEN=' + GITHUB_TOKEN,
      'OPENAI_API_KEY=' + OPENAI_KEY,
      'DATABASE_URL=' + DB_URL
    ].join('\n'));

    const result = scanArtifacts({
      workdir: fx.workdir,
      artifacts: artifactsOf(['leak.env'])
    });
    const serialized = JSON.stringify(result);

    assert.ok(result.findings.length > 0, 'findings exist');
    for (const secret of [AWS_KEY, GITHUB_TOKEN, OPENAI_KEY, DB_URL, 'hunter2pass']) {
      assert.ok(!serialized.includes(secret), 'scan output must not contain ' + secret);
    }
    for (const finding of result.findings) {
      assert.ok(finding.preview.endsWith('…'), 'every preview is truncated');
      assert.ok(finding.preview.length <= 5, 'preview stays a short prefix');
    }
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('dedupes per rule per file and counts occurrences', () => {
  const fx = fixture();
  try {
    writeFileSync(join(fx.workdir, 'twice.txt'),
      'first ' + AWS_KEY + '\nsecond ' + AWS_KEY + '\n');

    const result = scanArtifacts({
      workdir: fx.workdir,
      artifacts: artifactsOf(['twice.txt', 'twice.txt'])
    });

    const aws = result.findings.filter((f) => f.rule === 'aws_access_key_id');
    assert.equal(aws.length, 1, 'duplicate artifact records do not double-count');
    assert.equal(aws[0].occurrences, 2);
    assert.equal(aws[0].line, 1, 'first occurrence line is reported');
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('skips binary files, binary extensions, and oversized files with a reason', () => {
  const fx = fixture();
  try {
    writeFileSync(join(fx.workdir, 'blob.dat'), Buffer.from([0x41, 0x00, 0x42]));
    writeFileSync(join(fx.workdir, 'shot.png'), 'not really a png');
    writeFileSync(join(fx.workdir, 'huge.txt'), 'x'.repeat(2048));

    const result = scanArtifacts({
      workdir: fx.workdir,
      artifacts: artifactsOf(['blob.dat', 'shot.png', 'huge.txt', 'gone.txt']),
      opts: { maxFileBytes: 1024 }
    });

    const reasons = {};
    for (const skip of result.skipped) reasons[skip.path] = skip.reason;
    assert.equal(reasons['blob.dat'], 'binary');
    assert.equal(reasons['shot.png'], 'binary_extension');
    assert.equal(reasons['huge.txt'], 'too_large');
    assert.equal(reasons['gone.txt'], 'missing');
    assert.equal(result.scanned, 0);
    assert.equal(result.counts.files, 0);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('refuses artifact paths that escape the workdir and skips symlinks', () => {
  const fx = fixture();
  try {
    writeFileSync(join(fx.root, 'outside.txt'), 'leak ' + AWS_KEY + '\n');
    writeFileSync(join(fx.workdir, 'inside.txt'), 'clean\n');
    symlinkSync(join(fx.root, 'outside.txt'), join(fx.workdir, 'link.txt'));

    const result = scanArtifacts({
      workdir: fx.workdir,
      artifacts: artifactsOf(['../outside.txt', join(fx.root, 'outside.txt'), 'link.txt'])
    });

    const reasons = {};
    for (const skip of result.skipped) reasons[skip.path] = skip.reason;
    assert.equal(reasons['../outside.txt'], 'outside_workdir');
    assert.equal(reasons[join(fx.root, 'outside.txt')], 'outside_workdir');
    assert.equal(reasons['link.txt'], 'symlink');
    assert.equal(result.findings.length, 0, 'an escaping path is never read');
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('missing workdir is disclosed, never reported as clean', () => {
  const result = scanArtifacts({ workdir: '/tmp/visionary-does-not-exist-' + Date.now(), artifacts: [] });
  assert.equal(result.scanned, 0);
  assert.equal(result.counts.files, 0);
  assert.equal(result.findings.length, 0);
  assert.ok(result.warnings.includes('workdir_missing'));
  assert.ok(result.warnings.includes('stdout_not_scanned'));
});

test('discloses file and findings caps instead of silently passing', () => {
  const fx = fixture();
  try {
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(fx.workdir, 'f' + i + '.txt'), 'key ' + AWS_KEY + '\n');
    }
    const files = artifactsOf(['f0.txt', 'f1.txt', 'f2.txt', 'f3.txt', 'f4.txt']);

    const fileCapped = scanArtifacts({ workdir: fx.workdir, artifacts: files, opts: { maxFiles: 2 } });
    assert.ok(fileCapped.warnings.includes('file_cap_reached'));
    assert.equal(fileCapped.scanned, 2);

    const findingsCapped = scanArtifacts({ workdir: fx.workdir, artifacts: files, opts: { maxFindings: 1 } });
    assert.ok(findingsCapped.warnings.includes('findings_cap_reached'));
    assert.equal(findingsCapped.findings.length, 1);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('clean artifacts report files scanned and no findings', () => {
  const fx = fixture();
  try {
    writeFileSync(join(fx.workdir, 'report.md'), '# Quarterly report\nNo credentials here.\n');
    const result = scanArtifacts({ workdir: fx.workdir, artifacts: artifactsOf(['report.md']) });
    assert.equal(result.scanned, 1);
    assert.equal(result.counts.files, 1);
    assert.equal(result.findings.length, 0);
    assert.deepEqual(result.warnings, ['stdout_not_scanned']);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('is deterministic for a fixed workspace', () => {
  const fx = fixture();
  try {
    writeFileSync(join(fx.workdir, 'a.txt'), 'github ' + GITHUB_TOKEN + '\n');
    writeFileSync(join(fx.workdir, 'b.txt'), 'jwt ' + JWT + '\n');
    const args = { workdir: fx.workdir, artifacts: artifactsOf(['b.txt', 'a.txt']) };
    const first = scanArtifacts(args);
    const second = scanArtifacts(args);
    assert.deepEqual(first, second);
    assert.deepEqual(first.findings.map((f) => f.path), ['a.txt', 'b.txt'],
      'findings are sorted by path, not artifact order');
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('malformed artifact entries are skipped, not treated as clean files', () => {
  const fx = fixture();
  try {
    const result = scanArtifacts({
      workdir: fx.workdir,
      artifacts: [null, {}, { path: '' }, { path: 42 }]
    });
    assert.equal(result.scanned, 0);
    assert.ok(result.skipped.length >= 1);
    assert.ok(result.skipped.every((s) => s.reason === 'invalid_entry'));
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});
