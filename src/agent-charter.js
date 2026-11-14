'use strict';

// Agent charter inspector.
//
// Jake Van Clief's instruction-provenance / prompt-and-memory-hierarchy lesson:
// the charter is the durable instruction asset an agent is given, and it must be
// inspectable separately from the work it produces. Visionary prepends a
// personality charter to every dispatch, but until now the only place to read
// that charter was the markdown file on disk — the operator could not see what a
// position was actually told, nor whether the org chart's `personality_path`
// agreed with the file the dispatcher loads.
//
// This module is read-only and deterministic. It resolves the exact file the
// dispatcher reads (`personalities/agents/<agent_id>.md`, the same rule as
// `loadPersonality()` in server.js), parses the frontmatter, and reports drift:
// a charter whose `agent_id`/`reports_to`/`title` disagrees with the org chart is
// a silent behavior change, not a cosmetic one. Missing files are reported as
// missing — a configured path is evidence, not truth.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MAX_CHARS = 6000;
const FILE_ID_ALIASES = { main: 'argus', jarvis: 'argus' };

function dispatchFileId(agentId) {
  const id = String(agentId || '').trim();
  return FILE_ID_ALIASES[id] || id;
}

function relativeOrAbsolute(root, target) {
  if (!root) return target;
  const rel = path.relative(root, target);
  return rel && !rel.startsWith('..') ? rel : target;
}

// Minimal frontmatter splitter — same shape the org-chart validator accepts.
function splitFrontmatter(text) {
  const source = String(text || '');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { present: false, block: '', body: source.trim() };
  return { present: true, block: match[1], body: source.slice(match[0].length).trim() };
}

function parseScalar(raw) {
  let value = String(raw || '').trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  if (value === 'null' || value === '~') return null;
  if (/^\[.*\]$/.test(value)) {
    return value.slice(1, -1).split(',').map((v) => v.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  return value;
}

function parseFrontmatter(block) {
  const fields = {};
  for (const line of String(block || '').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    fields[m[1]] = parseScalar(m[2]);
  }
  return fields;
}

function listSections(body) {
  const sections = [];
  const re = /^##\s+(.+)$/gm;
  let m;
  while ((m = re.exec(String(body || ''))) !== null) {
    const title = m[1].trim();
    if (title) sections.push(title);
  }
  return sections;
}

function pushWarning(warnings, code, message) {
  warnings.push({ code, message });
}

// Org-chart names are short pod labels ("Intelligence") while director charters
// carry the formal title ("Director of Intelligence"). Dropping the "Director
// [of]" prefix is agreement, not drift; anything else that differs is drift.
function normalizeAgentName(name) {
  return String(name || '').trim().toLowerCase().replace(/^director\s+(of\s+)?/, '');
}

function namesAgree(charterName, orgName) {
  const a = normalizeAgentName(charterName);
  const b = normalizeAgentName(orgName);
  if (!a || !b) return true;
  return a === b;
}

// Read the charter the dispatcher would inject for this agent.
//   opts.agentId          agent id from the org chart / agents table
//   opts.personalityDir   absolute path to personalities/agents
//   opts.repoRoot         absolute repo root (for relative reporting)
//   opts.configuredPath   org-chart personality_path (may be null)
//   opts.orgNode          { id, name, title, role, reports_to } from the agents table
//   opts.maxChars         truncation limit used by the dispatcher (default 6000)
function readAgentCharter(opts) {
  const options = opts || {};
  const agentId = String(options.agentId || '');
  const fileId = dispatchFileId(agentId);
  const personalityDir = options.personalityDir;
  const repoRoot = options.repoRoot || null;
  const configuredPath = options.configuredPath || null;
  const orgNode = options.orgNode || null;
  const maxChars = Number.isFinite(Number(options.maxChars)) && Number(options.maxChars) > 0
    ? Number(options.maxChars)
    : DEFAULT_MAX_CHARS;

  const warnings = [];
  const base = {
    agent_id: agentId,
    file_id: fileId,
    dispatch_path: null,
    configured_path: configuredPath,
    exists: false,
    status: 'missing',
    injected_in_dispatch: false,
    char_count: 0,
    truncated: false,
    frontmatter: {},
    body: '',
    sections: [],
    warnings
  };

  if (!agentId) {
    base.status = 'missing';
    pushWarning(warnings, 'missing_agent_id', 'No agent id was supplied.');
    return base;
  }
  if (!personalityDir) {
    base.status = 'unreadable';
    pushWarning(warnings, 'missing_personality_dir', 'No personality directory was supplied.');
    return base;
  }

  const dispatchPath = path.join(personalityDir, fileId + '.md');
  base.dispatch_path = relativeOrAbsolute(repoRoot, dispatchPath);

  let text = '';
  try {
    base.exists = fs.existsSync(dispatchPath);
  } catch {
    base.exists = false;
  }
  if (!base.exists) {
    base.status = 'missing';
    pushWarning(warnings, 'charter_missing',
      'No charter file at ' + base.dispatch_path + ' — dispatches for this agent run without a personality.');
  } else {
    try {
      text = fs.readFileSync(dispatchPath, 'utf8');
    } catch (err) {
      base.status = 'unreadable';
      pushWarning(warnings, 'charter_unreadable',
        'Charter exists but could not be read: ' + (err && err.message ? err.message : 'unknown error'));
      return base;
    }
  }

  const split = splitFrontmatter(text);
  const fields = split.present ? parseFrontmatter(split.block) : {};
  const body = split.body || '';
  const truncated = body.length > maxChars;
  const visibleBody = truncated ? body.slice(0, maxChars) + '\n…[charter truncated]' : body;

  base.frontmatter = fields;
  base.body = visibleBody;
  base.sections = listSections(body);
  base.char_count = body.length;
  base.truncated = truncated;
  base.name = fields.name || (orgNode && orgNode.name) || null;
  base.title = fields.title || null;
  base.role = (orgNode && orgNode.role) || null;
  base.reports_to = fields.reports_to || null;
  base.harness_chain = Array.isArray(fields.harness_chain) ? fields.harness_chain : null;
  base.expected_activity_within_seconds = Number.isFinite(fields.expected_activity_within_seconds)
    ? fields.expected_activity_within_seconds
    : null;

  if (!split.present) {
    pushWarning(warnings, 'no_frontmatter',
      'Charter has no frontmatter block, so its agent_id/reports_to cannot be verified.');
  }
  if (!base.exists) {
    // Nothing was read; status stays 'missing'. Config drift is still reported
    // below because a broken personality_path is worth knowing about.
  } else if (!body) {
    base.status = 'empty';
    base.injected_in_dispatch = false;
    pushWarning(warnings, 'empty_body', 'Charter file has no body text — the dispatch gets no instructions.');
  } else {
    base.status = 'ok';
    base.injected_in_dispatch = true;
  }

  if (split.present) {
    if (!fields.agent_id) {
      pushWarning(warnings, 'missing_agent_id', 'Charter frontmatter has no agent_id.');
      if (base.status === 'ok') base.status = 'mismatch';
    } else if (String(fields.agent_id) !== fileId) {
      pushWarning(warnings, 'agent_id_mismatch',
        'Charter declares agent_id "' + fields.agent_id + '" but is loaded for "' + fileId + '".');
      if (base.status === 'ok') base.status = 'mismatch';
    }
  }

  if (orgNode) {
    if (orgNode.reports_to && fields.reports_to && String(fields.reports_to) !== String(orgNode.reports_to)) {
      pushWarning(warnings, 'reports_to_mismatch',
        'Charter reports_to "' + fields.reports_to + '" but the org chart says "' + orgNode.reports_to + '".');
    }
    if (orgNode.title && fields.title && String(fields.title) !== String(orgNode.title)) {
      pushWarning(warnings, 'title_mismatch',
        'Charter title "' + fields.title + '" differs from the org chart title "' + orgNode.title + '".');
    }
    if (orgNode.name && fields.name && !namesAgree(String(fields.name), String(orgNode.name))) {
      pushWarning(warnings, 'name_mismatch',
        'Charter name "' + fields.name + '" differs from the org chart name "' + orgNode.name + '".');
    }
  }

  // The org chart's personality_path is configuration; dispatch loads by agent id.
  // When they disagree, editing the chart silently does nothing.
  if (configuredPath) {
    const configuredAbs = path.isAbsolute(configuredPath)
      ? path.normalize(configuredPath)
      : path.normalize(path.join(repoRoot || process.cwd(), configuredPath));
    if (configuredAbs !== path.normalize(dispatchPath)) {
      pushWarning(warnings, 'config_path_drift',
        'Org chart personality_path "' + configuredPath + '" does not match the file dispatch loads ("'
        + base.dispatch_path + '").');
    }
    let configuredExists = false;
    try { configuredExists = fs.existsSync(configuredAbs); } catch { configuredExists = false; }
    if (!configuredExists) {
      pushWarning(warnings, 'config_path_missing',
        'Org chart personality_path "' + configuredPath + '" does not exist on disk.');
    }
  }

  if (truncated) {
    pushWarning(warnings, 'charter_truncated',
      'Charter body is ' + body.length + ' chars; dispatch injects only the first ' + maxChars + '.');
  }

  // The CEO was renamed jarvis -> argus; a charter still naming jarvis tells the
  // agent to report to an identity that no longer exists in the org.
  if (fileId !== 'jarvis' && /\bjarvis\b/i.test(body + ' ' + String(fields.reports_to || ''))) {
    pushWarning(warnings, 'retired_identity',
      'Charter still names the retired "jarvis" identity; the org chart CEO is argus.');
  }

  return base;
}

module.exports = {
  DEFAULT_MAX_CHARS,
  dispatchFileId,
  parseFrontmatter,
  splitFrontmatter,
  listSections,
  readAgentCharter
};
