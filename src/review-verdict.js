'use strict';

// Pure verdict parser extracted from triggerReview() in server.js.
// First structured APPROVE/REJECT line wins — never keyword-anywhere matching,
// which false-fired on the rubric echoed back in the reply.
//
// Returns { verdict: 'APPROVE'|'REJECT'|null, detail: string }
function parseVerdict(output) {
  if (typeof output !== 'string' || !output) {
    return { verdict: null, detail: '' };
  }
  var m = output.match(/\b(APPROVE|REJECT)\s*:\s*([^\n]*)/i);
  if (!m) {
    return { verdict: null, detail: '' };
  }
  var verdict = m[1].toUpperCase();
  var detail = (m[2] || '').trim().substring(0, 500);
  return { verdict: verdict, detail: detail };
}

module.exports = { parseVerdict: parseVerdict };
