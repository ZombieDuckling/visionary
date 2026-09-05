'use strict';

// Deterministic downstream-export nudge for dispatches where the useful output
// must move into another tool, format, repo, vendor handoff, or implementation
// surface. Inspired by Jake Van Clief's export lesson: the workbench is only
// useful if the next human/tool can continue from the source without chat
// archaeology.

const SOURCE_TERMS = [
  'source', 'deck', 'slides', 'presentation', 'brief', 'document', 'doc', 'docs',
  'spec', 'report', 'markdown', 'md', 'html', 'template', 'workbench', 'canva',
  'figma', 'repo', 'folder', 'files', 'artifact', 'artifacts'
];

const EXPORT_TERMS = [
  'export', 'convert', 'package', 'bundle', 'zip', 'download', 'handoff',
  'hand over', 'deliver', 'ship', 'publish', 'send', 'share', 'open in',
  'import into', 'move into', 'turn into', 'generate'
];

const TARGET_TERMS = [
  'canva', 'figma', 'powerpoint', 'ppt', 'pptx', 'slides', 'google slides',
  'claude code', 'cursor', 'contractor', 'vendor', 'designer', 'developer',
  'client', 'stakeholder', 'implementation', 'website', 'app', 'code', 'html',
  'pdf', 'docx', 'zip'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyDownstreamExport(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const sourceMatches = countMatches(text, SOURCE_TERMS);
  const exportMatches = countMatches(text, EXPORT_TERMS);
  const targetMatches = countMatches(text, TARGET_TERMS);
  const score = (sourceMatches * 2) + (exportMatches * 2) + targetMatches;

  if (sourceMatches === 0 || exportMatches === 0 || targetMatches === 0) {
    return { applies: false, reason: 'not downstream-export shaped', score };
  }
  if (score < 7) {
    return { applies: false, reason: 'weak downstream-export signal', score };
  }

  const layer = text.indexOf('contractor') !== -1 || text.indexOf('vendor') !== -1 || text.indexOf('client') !== -1
    ? 'human-handoff-package'
    : text.indexOf('claude code') !== -1 || text.indexOf('cursor') !== -1 || text.indexOf('repo') !== -1 || text.indexOf('code') !== -1
      ? 'implementation-ready-export'
      : 'format-export-package';

  return {
    applies: true,
    reason: 'deliverable likely needs a portable package for another tool or human',
    score,
    layer,
    signals: {
      source: sourceMatches,
      export: exportMatches,
      target: targetMatches
    }
  };
}

function downstreamExportPromptBlock(message) {
  const classification = classifyDownstreamExport(message);
  if (!classification.applies) return '';

  return '[DOWNSTREAM-EXPORT CHECK]\n'
    + 'If this task exports, packages, or hands off work, make the next surface explicit so the output is usable outside this chat. Keep this proportional to the task.\n'
    + '- Canonical source: name the source artifact/folder/deck/spec and preserve enough structure for future edits.\n'
    + '- Target consumer/tool: name who or what resumes next: Canva, PowerPoint, Claude Code, Cursor, vendor, contractor, client, or repo.\n'
    + '- Output package: state the exact files/formats to produce or describe, including source plus rendered/exported versions when useful.\n'
    + '- Continuation context: include setup notes, assumptions, open decisions, and where the next human/tool should start.\n'
    + '- Fidelity checks: verify key content survived the export and call out anything that may not translate cleanly.\n'
    + '- Review path: leave acceptance criteria and inspection points before treating the package as final.\n'
    + 'Do not overbuild an export system; just make the handoff package concrete and inspectable.\n'
    + '[/DOWNSTREAM-EXPORT CHECK]';
}

function appendDownstreamExportPrompt(message) {
  const block = downstreamExportPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyDownstreamExport,
  downstreamExportPromptBlock,
  appendDownstreamExportPrompt
};
