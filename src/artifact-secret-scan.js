'use strict';

// Deterministic credential-leak scan for run artifacts.
//
// A Visionary dispatch writes files into a per-task workdir and the dashboard
// then offers them for click-to-open, project-level indexing, and (for some
// workflows) eventual commit or client delivery. That is exactly the surface
// where a credential escapes: an agent pastes an API key into a report, writes
// a private key into a config file, prints a database URL with the password
// inline, or drops a `.env` next to the deliverable. Until now the
// secret-isolation control (docs/SECRET-ISOLATION-REVIEW.md) was a dispatch
// *instruction* — a hope that the agent obeys it — with nothing that checks the
// produced files afterward.
//
// This module is the check. It scans the artifact files a run recorded, using
// high-confidence credential shapes only (provider-prefixed keys, private-key
// blocks, bearer headers, URL-embedded passwords) plus one low-confidence
// generic assignment rule, and reports findings by rule and file. It never
// returns the matched value: findings carry a short prefix preview (`AKIA…`)
// so the operator can locate the line without the scan itself becoming a
// second copy of the secret.
//
// Applies Jake Van Clief's prompt-and-memory-hierarchy lesson (`S3fXSc5z2n4`,
// `5B6W2OGfxq0`): separate instructions, evidence, outputs, and credentials,
// and validate at boundaries. The credential boundary is not an instruction to
// trust; it is a property of the artifact to verify.
//
// Deliberate limits (all disclosed in the result):
// - Only files listed in the run's artifact record are scanned; harness
//   stdout/chat output is not.
// - Binary files and known non-text formats are skipped by extension and by a
//   NUL-byte probe, so a scan cannot pretend a PDF or a sqlite file was read.
// - A file cap and per-file byte cap keep a busy run from turning completion
//   into an unbounded read; over-cap files are reported as skipped, never
//   silently passed.
// - Findings are capped, and truncation is disclosed.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_LIMITS = {
  maxFiles: 60,
  maxFileBytes: 256 * 1024,
  maxFindings: 100
};

// Known non-text artifact types. Extension-based skips are honest and cheap;
// a text file with a misleading extension still gets the NUL-byte probe.
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.ico',
  '.heic', '.avif', '.pdf', '.zip', '.gz', '.tgz', '.bz2', '.xz', '.7z',
  '.tar', '.rar', '.dmg', '.pkg', '.app', '.exe', '.bin', '.wasm',
  '.mp3', '.wav', '.aiff', '.flac', '.ogg', '.m4a', '.mp4', '.mov', '.avi',
  '.mkv', '.webm', '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.sqlite', '.sqlite3', '.db', '.sqlite-wal', '.sqlite-shm'
]);

// High-confidence credential shapes. Each rule is deliberately specific: a
// provider prefix or a structurally unique token format. The one low-confidence
// rule is marked `low` and exists to catch obvious `api_key = "..."` literals;
// it is expected to fire on documentation examples, so severity is disclosed.
const RULES = [
  {
    id: 'private_key_block',
    severity: 'high',
    description: 'PEM private key block',
    re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g
  },
  {
    id: 'aws_access_key_id',
    severity: 'high',
    description: 'AWS access key id',
    re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g
  },
  {
    id: 'aws_secret_access_key',
    severity: 'high',
    description: 'AWS secret access key assignment',
    re: /aws_secret_access_key\s*[=:]\s*['"]?[A-Za-z0-9/+]{40}/gi
  },
  {
    id: 'github_token',
    severity: 'high',
    description: 'GitHub personal access / app token',
    re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g
  },
  {
    id: 'slack_token',
    severity: 'high',
    description: 'Slack bot/user/app token',
    re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g
  },
  {
    id: 'stripe_live_key',
    severity: 'high',
    description: 'Stripe live secret/restricted key',
    re: /\b[sr]k_live_[A-Za-z0-9]{16,}\b/g
  },
  {
    id: 'google_api_key',
    severity: 'high',
    description: 'Google API key',
    re: /\bAIza[0-9A-Za-z_-]{35}\b/g
  },
  {
    id: 'openai_key',
    severity: 'high',
    description: 'OpenAI-style secret key',
    re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g
  },
  {
    id: 'db_url_password',
    severity: 'high',
    description: 'Database URL with inline password',
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s@/]+@/gi
  },
  {
    id: 'jwt',
    severity: 'medium',
    description: 'JSON Web Token',
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
  },
  {
    id: 'bearer_token',
    severity: 'medium',
    description: 'Bearer authorization header',
    re: /Authorization\s*:\s*Bearer\s+[A-Za-z0-9._-]{20,}/gi
  },
  {
    id: 'generic_secret_assignment',
    severity: 'low',
    description: 'Generic api_key/secret/token/password assignment (may be a placeholder)',
    re: /\b(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['"][A-Za-z0-9._+\-]{16,}['"]/gi
  }
];

function normalizeLimits(opts) {
  const out = {};
  const input = opts || {};
  for (const key of Object.keys(DEFAULT_LIMITS)) {
    const value = input[key];
    out[key] = (typeof value === 'number' && Number.isFinite(value) && value > 0)
      ? Math.floor(value)
      : DEFAULT_LIMITS[key];
  }
  return out;
}

// A preview is a prefix only — enough to recognise the rule fired, never enough
// to reconstruct the credential. The scan must not become a copy of the secret.
function previewOf(match) {
  const text = String(match || '');
  if (text.length <= 4) return '…';
  return text.slice(0, 4) + '…';
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

// Read a text artifact within limits. Returns { ok, text, reason }.
function readTextArtifact(fullPath, maxBytes) {
  let stat;
  try { stat = fs.lstatSync(fullPath); } catch { return { ok: false, reason: 'missing' }; }
  if (stat.isSymbolicLink()) return { ok: false, reason: 'symlink' };
  if (!stat.isFile()) return { ok: false, reason: 'not_a_file' };
  if (stat.size > maxBytes) return { ok: false, reason: 'too_large', size: stat.size };
  let buffer;
  try { buffer = fs.readFileSync(fullPath); } catch { return { ok: false, reason: 'unreadable' }; }
  const probe = buffer.subarray(0, 8192);
  if (probe.includes(0)) return { ok: false, reason: 'binary' };
  return { ok: true, text: buffer.toString('utf8'), size: stat.size };
}

function scanArtifacts(input) {
  const workdir = input && input.workdir ? String(input.workdir) : null;
  const artifacts = Array.isArray(input && input.artifacts) ? input.artifacts : [];
  const limits = normalizeLimits(input && input.opts);

  const result = {
    workdir,
    scanned: 0,
    skipped: [],
    findings: [],
    counts: { files: 0, findings: 0, high: 0, medium: 0, low: 0 },
    warnings: [],
    limits
  };

  if (!workdir) {
    result.warnings.push('workdir_missing');
    result.warnings.push('stdout_not_scanned');
    return result;
  }

  let root;
  try {
    root = fs.realpathSync(workdir);
  } catch {
    result.warnings.push('workdir_missing');
    result.warnings.push('stdout_not_scanned');
    return result;
  }

  // Dedupe artifact paths so a duplicated record cannot double-count findings.
  const seenPaths = new Set();
  let inspected = 0;
  let truncatedFindings = false;

  for (const entry of artifacts) {
    if (inspected >= limits.maxFiles) {
      result.warnings.push('file_cap_reached');
      break;
    }
    const rel = entry && typeof entry.path === 'string' ? entry.path : null;
    if (!rel) {
      result.skipped.push({ path: null, reason: 'invalid_entry' });
      continue;
    }
    if (seenPaths.has(rel)) continue;
    seenPaths.add(rel);
    inspected++;

    const ext = path.extname(rel).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      result.skipped.push({ path: rel, reason: 'binary_extension' });
      continue;
    }

    const resolved = path.resolve(root, rel);
    if (path.isAbsolute(rel) || (resolved !== root && !resolved.startsWith(root + path.sep))) {
      result.skipped.push({ path: rel, reason: 'outside_workdir' });
      continue;
    }

    const read = readTextArtifact(resolved, limits.maxFileBytes);
    if (!read.ok) {
      result.skipped.push({ path: rel, reason: read.reason, size: read.size });
      continue;
    }

    result.scanned++;
    result.counts.files++;

    for (const rule of RULES) {
      // A fresh RegExp per file/rule keeps lastIndex state out of the loop.
      const re = new RegExp(rule.re.source, rule.re.flags);
      let match;
      let first = null;
      let occurrences = 0;
      while ((match = re.exec(read.text)) !== null) {
        occurrences++;
        if (!first) {
          first = { line: lineOf(read.text, match.index), preview: previewOf(match[0]) };
        }
        if (match[0].length === 0) re.lastIndex++; // defensive: never spin
      }
      if (!occurrences) continue;
      if (result.findings.length >= limits.maxFindings) {
        truncatedFindings = true;
        break;
      }
      result.findings.push({
        path: rel,
        rule: rule.id,
        severity: rule.severity,
        description: rule.description,
        line: first.line,
        occurrences,
        preview: first.preview
      });
    }
    if (truncatedFindings) break;
  }

  if (truncatedFindings) result.warnings.push('findings_cap_reached');
  result.warnings.push('stdout_not_scanned');

  result.findings.sort(function (a, b) {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return a.rule < b.rule ? -1 : (a.rule > b.rule ? 1 : 0);
  });
  for (const finding of result.findings) {
    result.counts.findings++;
    result.counts[finding.severity]++;
  }
  return result;
}

module.exports = { scanArtifacts, RULES, DEFAULT_LIMITS };
