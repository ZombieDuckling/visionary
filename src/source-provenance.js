'use strict';

// Deterministic source-provenance nudge for research/data synthesis work.
// Inspired by Jake Van Clief's research-data-care lesson: organizing knowledge
// with AI is only useful if future operators can see the source material,
// confidence, transformations, gaps, source-signal strength, and verification
// path instead of receiving an untraceable polished summary.

const SOURCE_WORK_TERMS = [
  'research', 'analyze', 'analyse', 'analysis', 'synthesize', 'synthesise',
  'summarize', 'summarise', 'organize', 'organise', 'classify', 'categorize',
  'dataset', 'data set', 'spreadsheet', 'csv', 'transcript', 'interview',
  'notes', 'archive', 'knowledgebase', 'knowledge base', 'sources', 'evidence',
  'citations', 'literature', 'repo', 'repository', 'audit', 'report'
];

const OUTPUT_TERMS = [
  'brief', 'summary', 'index', 'map', 'taxonomy', 'table', 'matrix', 'database',
  'dashboard', 'insights', 'recommendations', 'findings', 'lessons', 'patterns',
  'themes', 'manifest', 'catalog', 'catalogue', 'clean', 'dedupe', 'deduplicate'
];

const PROVENANCE_TERMS = [
  'source id', 'source ids', 'provenance', 'citation', 'citations', 'confidence',
  'confidence level', 'raw source', 'raw sources', 'source file', 'source files',
  'source url', 'source urls', 'quote', 'quotes', 'line number', 'line numbers',
  'verified', 'verification', 'assumption', 'assumptions', 'gap', 'gaps',
  'methodology', 'method', 'audit trail', 'traceability'
];

const SOURCE_SIGNAL_TERMS = [
  'metadata-only', 'metadata only', 'low signal', 'low-signal', 'subtitles disabled',
  'transcript unavailable', 'unavailable transcript', 'pointer clip', 'ambience',
  'atmospheric', 'source context', 'signal', 'evidence level', 'source quality'
];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    const pattern = new RegExp('(^|[^a-z0-9])' + escapeRegExp(term) + '($|[^a-z0-9])', 'i');
    return pattern.test(text) ? count + 1 : count;
  }, 0);
}

function classifySourceProvenance(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const sourceWork = countMatches(text, SOURCE_WORK_TERMS);
  const output = countMatches(text, OUTPUT_TERMS);
  const provenance = countMatches(text, PROVENANCE_TERMS);
  const sourceSignal = countMatches(text, SOURCE_SIGNAL_TERMS);
  const score = (sourceWork * 2) + output + sourceSignal - (provenance * 2);

  if (provenance >= 3) {
    return { applies: false, reason: 'operator already supplied source-provenance frame', score };
  }
  if (sourceWork === 0) {
    return { applies: false, reason: 'no research/data/source signal', score };
  }
  if (output === 0 && sourceWork < 2) {
    return { applies: false, reason: 'weak source-synthesis signal', score };
  }
  if (score < 4) {
    return { applies: false, reason: 'source work is already narrow enough', score };
  }

  const layer = sourceSignal >= 2
    ? 'source-signal-sorting'
    : sourceWork >= 3 && output >= 2
    ? 'provenance-workbench'
    : output >= 1
      ? 'traceable-synthesis'
      : 'source-gap-check';

  return {
    applies: true,
    reason: 'research/data synthesis should keep conclusions traceable to sources',
    score,
    layer,
    signals: {
      source_work: sourceWork,
      output,
      provenance,
      source_signal: sourceSignal
    }
  };
}

function sourceProvenancePromptBlock(message) {
  const classification = classifySourceProvenance(message);
  if (!classification.applies) return '';

  return '[SOURCE-PROVENANCE CHECK]\n'
    + 'This looks like research/data/source synthesis. Do not produce a polished answer that loses the audit trail. Before concluding, make the source trail inspectable and then complete the task.\n'
    + '- Source inventory: name the files, URLs, records, transcripts, repos, datasets, or notes used; if source IDs exist, preserve them exactly.\n'
    + '- Signal level: label transcript-backed, metadata-only, pointer/ambience, partial, conflicting, or low-signal sources plainly; do not inflate weak source context into durable lessons.\n'
    + '- Transformations: state what was extracted, cleaned, grouped, inferred, or excluded.\n'
    + '- Confidence and gaps: separate sourced facts from interpretation, assumptions, missing material, and low-confidence claims.\n'
    + '- Reusable structure: save the result as an index, table, taxonomy, manifest, or workbench artifact when that will help the next operator continue.\n'
    + '- Verification: name the spot checks, parser checks, link/file checks, or sample rows that prove the output maps back to real sources.\n'
    + 'Keep this concise; provenance should make the deliverable safer and easier to reuse, not bury it in process.\n'
    + '[/SOURCE-PROVENANCE CHECK]';
}

function appendSourceProvenancePrompt(message) {
  const block = sourceProvenancePromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifySourceProvenance,
  sourceProvenancePromptBlock,
  appendSourceProvenancePrompt
};
