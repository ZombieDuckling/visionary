'use strict';

// Project decision ledger.
//
// Jake Van Clief's vision/decision lesson (`YETgVWRHilw`, concept
// `vision-files-and-decision-transcripts`): code is a stack of decisions, and
// the decisions are the durable asset. A transcript is raw material; a dated
// decision record is the artifact. Multi-agent work needs a shared "why"
// surface, otherwise every agent makes a locally plausible change and the
// project drifts in globally inconsistent directions.
//
// This module is the deterministic core of that surface. It does not write to
// the DB: it validates a decision record, builds the ledger with lifecycle
// warnings, and renders a bounded prompt block so a dispatch reads the
// project's accepted decisions before editing. Keeping the rules here (and not
// in the route) means the same validation applies to the API, the UI form, and
// any future importer.
//
// Design rules from the source concept:
//   - record the why before the diff: a decision without a rationale is noise;
//   - keep decisions alive and dated: stale accepted decisions are worse than
//     none because workers treat them as current intent;
//   - separate standing direction from per-feature decisions: the ledger holds
//     individual records, the project description holds direction;
//   - make the opinion layer model-portable: plain text, no vendor constructs.

const STATUSES = ['proposed', 'accepted', 'rejected', 'superseded'];

const DEFAULTS = {
  max_decisions: 500,
  prompt_max_decisions: 6,
  prompt_max_chars: 2500,
  stale_after_days: 180,
  title_max_chars: 200,
  decision_max_chars: 4000,
  rationale_max_chars: 4000,
  short_text_max_chars: 1000,
  decided_by_max_chars: 120
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanText(value, maxChars) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const cap = maxChars || DEFAULTS.short_text_max_chars;
  return text.length > cap ? text.slice(0, cap) : text;
}

function normalizeDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  // Accept a date or a full ISO timestamp; store the date only. The date is
  // what makes a decision citable ("we chose X on Y"), so precision beyond the
  // day is not load-bearing.
  const datePart = raw.length >= 10 ? raw.slice(0, 10) : raw;
  if (!DATE_RE.test(datePart)) return { error: 'decided_at must be YYYY-MM-DD' };
  const parsed = Date.parse(datePart + 'T00:00:00Z');
  if (!Number.isFinite(parsed)) return { error: 'decided_at is not a real date' };
  // Reject impossible calendar dates that Date.parse silently rolls over
  // (2026-02-31 -> March 3) by round-tripping the ISO date.
  const roundTrip = new Date(parsed).toISOString().slice(0, 10);
  if (roundTrip !== datePart) return { error: 'decided_at is not a real date' };
  return { value: datePart };
}

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function validateDecisionInput(input, opts) {
  const options = Object.assign({}, DEFAULTS, opts || {});
  const errors = [];
  const value = {};

  const title = cleanText(input && input.title, options.title_max_chars);
  if (!title) errors.push('title is required');
  else value.title = title;

  const decision = cleanText(input && input.decision, options.decision_max_chars);
  if (!decision) errors.push('decision is required — state what was chosen');
  else value.decision = decision;

  const rationale = cleanText(input && input.rationale, options.rationale_max_chars);
  if (!rationale) errors.push('rationale is required — record the why, not just the what');
  else value.rationale = rationale;

  value.alternatives_rejected = cleanText(input && input.alternatives_rejected, options.decision_max_chars);
  value.constraints = cleanText(input && input.constraints, options.decision_max_chars);
  value.decided_by = cleanText(input && input.decided_by, options.decided_by_max_chars);
  value.source = cleanText(input && input.source, options.decided_by_max_chars);

  const status = input && input.status !== undefined && input.status !== null
    ? String(input.status).trim().toLowerCase()
    : 'proposed';
  if (STATUSES.indexOf(status) === -1) {
    errors.push('status must be one of: ' + STATUSES.join(', '));
  } else {
    value.status = status;
  }

  const dateResult = normalizeDate(input && input.decided_at);
  if (dateResult && dateResult.error) errors.push(dateResult.error);
  else value.decided_at = dateResult ? dateResult.value : null;

  const supersedes = positiveInt(input && input.supersedes_id);
  if (input && input.supersedes_id !== undefined && input.supersedes_id !== null && input.supersedes_id !== '' && !supersedes) {
    errors.push('supersedes_id must be a positive integer');
  }
  value.supersedes_id = supersedes;

  const taskId = positiveInt(input && input.task_id);
  if (input && input.task_id !== undefined && input.task_id !== null && input.task_id !== '' && !taskId) {
    errors.push('task_id must be a positive integer');
  }
  value.task_id = taskId;

  return { ok: errors.length === 0, errors, value };
}

function parseRowDate(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  if (DATE_RE.test(text.slice(0, 10))) return Date.parse(text.slice(0, 10) + 'T00:00:00Z');
  return Date.parse(text.replace(' ', 'T') + 'Z');
}

function ageDays(row, nowMs) {
  const decided = parseRowDate(row.decided_at);
  const created = parseRowDate(row.created_at);
  const anchor = Number.isFinite(decided) ? decided : (Number.isFinite(created) ? created : null);
  if (anchor === null) return null;
  return Math.max(0, Math.floor((nowMs - anchor) / 86400000));
}

function buildDecisionLedger(rows, opts) {
  const options = Object.assign({}, DEFAULTS, opts || {});
  const nowMs = options.now ? new Date(options.now).getTime() : Date.now();
  const input = Array.isArray(rows) ? rows.slice(0, options.max_decisions) : [];

  const totals = {
    total: 0,
    accepted: 0,
    proposed: 0,
    rejected: 0,
    superseded: 0,
    stale: 0,
    undated: 0,
    dangling_supersedes: 0
  };
  const warnings = [];
  const byId = new Map();
  const decisions = [];

  for (const row of input) {
    if (!row || typeof row !== 'object') continue;
    const status = STATUSES.indexOf(row.status) === -1 ? 'proposed' : row.status;
    const record = {
      id: Number(row.id),
      project_id: Number(row.project_id),
      task_id: row.task_id === null || row.task_id === undefined ? null : Number(row.task_id),
      title: String(row.title || ''),
      decision: String(row.decision || ''),
      rationale: String(row.rationale || ''),
      alternatives_rejected: row.alternatives_rejected || null,
      constraints: row.constraints || null,
      status,
      decided_by: row.decided_by || null,
      decided_at: row.decided_at || null,
      supersedes_id: row.supersedes_id === null || row.supersedes_id === undefined ? null : Number(row.supersedes_id),
      source: row.source || null,
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
      superseded_by: null,
      age_days: ageDays(row, nowMs),
      stale: false,
      flags: []
    };

    totals.total += 1;
    if (status === 'accepted') totals.accepted += 1;
    if (status === 'proposed') totals.proposed += 1;
    if (status === 'rejected') totals.rejected += 1;
    if (status === 'superseded') totals.superseded += 1;

    if (status === 'accepted' && !record.decided_at) {
      record.flags.push('undated');
      totals.undated += 1;
    }
    if (status === 'accepted' && record.age_days !== null && record.age_days > options.stale_after_days) {
      record.flags.push('stale');
      record.stale = true;
      totals.stale += 1;
    }
    decisions.push(record);
    byId.set(record.id, record);
  }

  for (const record of decisions) {
    if (record.supersedes_id !== null) {
      const target = byId.get(record.supersedes_id);
      if (!target) {
        record.flags.push('dangling_supersedes');
        totals.dangling_supersedes += 1;
      } else {
        target.superseded_by = record.id;
      }
    }
    if (record.status === 'superseded' && record.superseded_by === null) {
      record.flags.push('superseded_without_replacement');
    }
  }

  if (totals.stale > 0) {
    warnings.push(totals.stale + ' accepted decision(s) are older than ' + options.stale_after_days
      + ' days. Re-confirm or supersede them so agents do not treat stale intent as current.');
  }
  if (totals.undated > 0) {
    warnings.push(totals.undated + ' accepted decision(s) have no decided_at date.');
  }
  if (totals.dangling_supersedes > 0) {
    warnings.push(totals.dangling_supersedes + ' decision(s) supersede a record that is not in this ledger.');
  }

  decisions.sort(function (a, b) {
    const at = String(a.decided_at || a.created_at || '');
    const bt = String(b.decided_at || b.created_at || '');
    if (at !== bt) return at < bt ? 1 : -1;
    return b.id - a.id;
  });

  return {
    ok: true,
    totals,
    decisions,
    warnings,
    stale_after_days: options.stale_after_days,
    truncated: input.length >= options.max_decisions
  };
}

// Render the accepted decisions as a bounded prompt block. Only accepted
// decisions are injected: proposed/rejected/superseded records are evidence for
// humans, not standing constraints for an agent. Entries are dropped whole at
// the character cap, and the caller records what was dropped.
function renderDecisionsPromptBlock(rows, opts) {
  const options = Object.assign({}, DEFAULTS, opts || {});
  const accepted = (Array.isArray(rows) ? rows : [])
    .filter(function (row) { return row && row.status === 'accepted'; })
    .slice(0, options.prompt_max_decisions);

  if (!accepted.length) return null;

  const header = '[PROJECT DECISION RECORD — accepted decisions for this project. Treat them as standing constraints. '
    + 'Do not contradict one without recording a new decision.]';
  const lines = [];
  let chars = header.length;
  const ids = [];

  for (const row of accepted) {
    const date = String(row.decided_at || row.created_at || '').slice(0, 10) || 'undated';
    const title = String(row.title || '').slice(0, 120);
    const decision = String(row.decision || '').slice(0, 220);
    const rationale = String(row.rationale || '').slice(0, 240);
    const by = row.decided_by ? ' (decided by ' + String(row.decided_by).slice(0, 60) + ')' : '';
    const line = '- ' + date + ' · ' + title + ': ' + decision + ' Why: ' + rationale + by;
    // The first entry is always included so the strongest decision lands even
    // if the cap is set below one line; later entries are dropped whole.
    if (chars + 1 + line.length > options.prompt_max_chars && lines.length > 0) continue;
    lines.push(line);
    chars += 1 + line.length;
    ids.push(Number(row.id));
  }

  if (!lines.length) return null;

  const text = header + '\n' + lines.join('\n');
  return {
    text,
    count: lines.length,
    chars: text.length,
    ids,
    dropped: accepted.length - lines.length
  };
}

module.exports = {
  STATUSES,
  DEFAULTS,
  validateDecisionInput,
  buildDecisionLedger,
  renderDecisionsPromptBlock
};
