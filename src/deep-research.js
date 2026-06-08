// Deep Research pipeline — adapted from odysseus's deep_research module.
//
// Workflow:
//   1. Decompose: agent breaks the research question into N sub-queries.
//   2. Investigate: dispatch each sub-query as its own agent run (so each one
//      can fail over independently across harnesses).
//   3. Synthesize: agent merges sub-findings into a Markdown report.
//
// Pure logic + DB writes. No new npm deps.

function parseSubQueries(rawText, maxQueries) {
  // Accept output as a numbered list, bullet list, or one question per line.
  if (!rawText) return [];
  const lines = String(rawText).split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  const cleaned = lines.map((line) =>
    line.replace(/^\s*(?:[-*+]|\d+[.)])\s*/, '').trim()
  ).filter((l) => l.length > 5 && l.length < 400);
  for (const c of cleaned) {
    if (out.length >= (maxQueries || 5)) break;
    out.push(c);
  }
  return out;
}

function buildDecomposePrompt(question, n) {
  return [
    'You are a research planner. Break this question into ' + (n || 5) + ' specific,',
    'independent sub-queries that, when answered together, fully address the original.',
    '',
    'Rules:',
    '- One question per line, no numbering, no commentary.',
    '- Each sub-query must be answerable on its own.',
    '- Cover different angles (history, current state, controversies, evidence, future).',
    '',
    'Original question:',
    question
  ].join('\n');
}

function buildInvestigatePrompt(subQuery) {
  return [
    'Answer the following research sub-question. Be concrete: cite sources where',
    'possible, give numbers, name specific actors/dates. 200-400 words.',
    '',
    'Sub-question: ' + subQuery
  ].join('\n');
}

function buildSynthesisPrompt(question, findings) {
  const body = findings.map((f, i) =>
    '### Sub-finding ' + (i + 1) + ': ' + f.subQuery + '\n\n' + (f.text || '(no answer)')
  ).join('\n\n');
  return [
    'Write a comprehensive research report answering the original question.',
    'Use Markdown. Start with a one-paragraph executive summary, then a section',
    'per major theme. End with "Open questions / what to verify next".',
    '',
    'Original question: ' + question,
    '',
    'Findings to synthesize:',
    '',
    body
  ].join('\n');
}

/**
 * Run a full deep-research cycle.
 *
 * @param {Object} deps - { dispatch: async (message, options) => { status, stdout } }
 * @param {Object} opts - { question, subQueries?, onProgress?, maxQueries? }
 * @returns {Promise<{ question, subQueries, findings, report, errors }>}
 */
async function runResearch(deps, opts) {
  const { dispatch } = deps;
  const question = String(opts.question || '').trim();
  if (!question) throw new Error('question is required');
  const maxQueries = opts.maxQueries || 5;
  const onProgress = opts.onProgress || function () {};
  const errors = [];

  onProgress({ phase: 'decompose', detail: 'planning sub-queries' });
  let subQueries = Array.isArray(opts.subQueries) ? opts.subQueries.slice() : null;
  if (!subQueries) {
    const decompose = await dispatch(buildDecomposePrompt(question, maxQueries), { phase: 'decompose' });
    subQueries = parseSubQueries(decompose.stdout, maxQueries);
    if (decompose.status !== 'ok') errors.push({ phase: 'decompose', detail: decompose.stderr });
  }
  if (!subQueries.length) {
    return { question, subQueries: [], findings: [], report: null, errors: errors.concat([{ phase: 'decompose', detail: 'no sub-queries produced' }]) };
  }

  const findings = [];
  for (let i = 0; i < subQueries.length; i++) {
    const sq = subQueries[i];
    onProgress({ phase: 'investigate', step: i + 1, of: subQueries.length, detail: sq });
    const resp = await dispatch(buildInvestigatePrompt(sq), { phase: 'investigate', subQuery: sq });
    if (resp.status === 'ok') {
      findings.push({ subQuery: sq, text: resp.stdout, harness: resp.harness });
    } else {
      findings.push({ subQuery: sq, text: '(failed: ' + (resp.stderr || resp.status) + ')', harness: resp.harness || null });
      errors.push({ phase: 'investigate', subQuery: sq, detail: resp.stderr });
    }
  }

  onProgress({ phase: 'synthesize' });
  const synth = await dispatch(buildSynthesisPrompt(question, findings), { phase: 'synthesize' });
  if (synth.status !== 'ok') errors.push({ phase: 'synthesize', detail: synth.stderr });
  const report = synth.stdout || null;

  return { question, subQueries, findings, report, errors };
}

module.exports = { runResearch, parseSubQueries, buildDecomposePrompt, buildInvestigatePrompt, buildSynthesisPrompt };
