// Auto-review helpers.
//
// The Reviewer agent is asked to respond with a verdict line:
//   APPROVE: <summary>   or   REJECT: <feedback>
//
// Historically the server substring-matched APPROVE/REJECT anywhere in the raw
// `--json` CLI output. That misfired constantly: the JSON envelope echoes
// prompt text, verbose reviews contain both words mid-sentence, and output
// with neither token left the task stuck in the in-memory review set forever.
// This module parses the reviewer's actual response text and only honors a
// line-anchored verdict; anything else is reported as 'inconclusive' so the
// caller can surface it instead of guessing.

function stripAnsi(str) {
  return String(str || '').replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

// Strip ANSI + drop [plugins] warning lines that corrupt JSON output.
function cleanCliOutput(raw) {
  return stripAnsi(raw)
    .split('\n')
    .filter(line => !line.startsWith('[plugins]'))
    .join('\n')
    .trim();
}

// Pull the agent's response text out of an openclaw `--json` envelope.
// Mirrors the extraction dispatchAgent does for regular runs.
function extractAgentText(cleaned) {
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.payloads && Array.isArray(parsed.payloads)) {
      return parsed.payloads.map(p => p.text).join('\n');
    }
    if (parsed.result) {
      return typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result);
    }
  } catch {
    // Not JSON — treat as plain text.
  }
  return cleaned;
}

// A verdict only counts when APPROVE/REJECT (or APPROVED/REJECTED) leads a
// line (allowing markdown emphasis/heading/list prefixes), so prose like
// "I cannot approve this" or echoed format instructions never trigger one.
const VERDICT_LINE = /^[\s>*#`-]*(APPROVED?|REJECT(?:ED)?)\b[:.\s]*(.*)$/i;

/**
 * Parse the reviewer's raw CLI output into a verdict.
 * @returns {{ verdict: 'approve'|'reject'|'inconclusive', summary: string, text: string }}
 *   `summary` is the remainder of the verdict line (approval summary or
 *   rejection feedback); `text` is the extracted reviewer response.
 */
function parseReviewVerdict(rawOutput) {
  const text = extractAgentText(cleanCliOutput(rawOutput));
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(VERDICT_LINE);
    if (m) {
      return {
        verdict: m[1].toUpperCase().startsWith('APPROVE') ? 'approve' : 'reject',
        summary: m[2].replace(/[*`]+$/, '').trim(),
        text
      };
    }
  }
  return { verdict: 'inconclusive', summary: '', text };
}

const REVIEW_EXCERPT_CHARS = 2000;

// Balanced review prompt. The old prompt ("Be strict. Only approve work that
// the user can use immediately.") drove a ~98% rejection rate — especially on
// long outputs where the reviewer only sees a truncated excerpt.
function buildReviewPrompt(task, originalAgent, resultText) {
  const excerpt = (resultText || 'No output captured').substring(0, REVIEW_EXCERPT_CHARS);
  const truncated = (resultText || '').length > REVIEW_EXCERPT_CHARS;
  return 'Review the output from agent "' + originalAgent + '" on task #' + task.id + ': "' + (task.title || '') + '".\n\n'
    + 'Task description: ' + (task.description || 'None') + '\n\n'
    + 'Agent output' + (truncated ? ' (excerpt — the full output is longer; do NOT penalize truncation)' : '') + ':\n'
    + excerpt + '\n\n'
    + 'Evaluate whether the output addresses the task. APPROVE work that is a reasonable, usable response to the task.\n'
    + 'REJECT only for concrete, fixable defects: the output ignores the task, is factually wrong, is empty/an error message, or is missing an explicitly requested deliverable. Name the specific defect.\n\n'
    + 'Your reply MUST start with a verdict on the first line, in exactly one of these formats:\n'
    + 'APPROVE: [one-line summary of what was delivered]\n'
    + 'REJECT: [specific issues that need fixing]';
}

module.exports = { parseReviewVerdict, buildReviewPrompt, extractAgentText, REVIEW_EXCERPT_CHARS };
