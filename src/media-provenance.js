'use strict';

// Deterministic media-provenance nudge for generated/edited media work.
// Inspired by Jake Van Clief's folder-based generated-media workflow: a useful
// media workbench keeps source assets, prompt/spec, model/tool metadata, style
// variants, edits, approvals, and final exports traceable in one resumable place.

const MEDIA_TERMS = [
  'video', 'short', 'reel', 'clip', 'image', 'photo', 'picture', 'graphic',
  'poster', 'thumbnail', 'audio', 'voice', 'voiceover', 'music', 'song',
  'animation', 'render', 'ad', 'advert', 'campaign', 'media'
];

const GENERATION_TERMS = [
  'generate', 'create', 'make', 'produce', 'render', 'edit', 'remix', 'variant',
  'variants', 'style', 'styles', 'take', 'takes', 'version', 'versions', 'prompt',
  'model', 'sora', 'veo', 'runway', 'midjourney', 'suno', 'elevenlabs', 'ai'
];

const PROVENANCE_TERMS = [
  'source', 'asset', 'assets', 'original', 'metadata', 'manifest', 'folder',
  'prompt', 'spec', 'caption', 'captions', 'subtitle', 'subtitles', 'approval',
  'approve', 'rights', 'license', 'credit', 'export', 'final', 'deliverable'
];

const EXISTING_PROVENANCE_TERMS = [
  'media provenance', 'provenance manifest', 'prompt/spec ledger',
  'tool/model metadata', 'media-provenance check'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function hasExistingProvenanceFrame(text) {
  return EXISTING_PROVENANCE_TERMS.some(function (term) { return text.indexOf(term) !== -1; });
}

function classifyMediaProvenance(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }
  if (hasExistingProvenanceFrame(text)) {
    return { applies: false, reason: 'operator already supplied media-provenance frame', score: 0 };
  }

  const mediaMatches = countMatches(text, MEDIA_TERMS);
  const generationMatches = countMatches(text, GENERATION_TERMS);
  const provenanceMatches = countMatches(text, PROVENANCE_TERMS);
  const score = (mediaMatches * 2) + (generationMatches * 2) + provenanceMatches;

  if (mediaMatches === 0 || generationMatches === 0) {
    return { applies: false, reason: 'not generated-media shaped', score };
  }
  if (score < 6) {
    return { applies: false, reason: 'weak media-provenance signal', score };
  }

  const layer = text.indexOf('voice') !== -1 || text.indexOf('audio') !== -1 || text.indexOf('music') !== -1 || text.indexOf('song') !== -1
    ? 'audio-provenance'
    : text.indexOf('image') !== -1 || text.indexOf('photo') !== -1 || text.indexOf('thumbnail') !== -1 || text.indexOf('poster') !== -1
      ? 'image-provenance'
      : 'video-provenance';

  return {
    applies: true,
    reason: 'generated media needs source, model, variant, edit, and approval provenance',
    score,
    layer,
    signals: {
      media: mediaMatches,
      generation: generationMatches,
      provenance: provenanceMatches
    }
  };
}

function mediaProvenancePromptBlock(message) {
  const classification = classifyMediaProvenance(message);
  if (!classification.applies) return '';

  return '[MEDIA-PROVENANCE CHECK]\n'
    + 'If this task creates or edits generated media, keep a small provenance trail so the operator can review, reuse, and defend the final asset. Keep it proportional; do not invent missing rights, sources, or approvals.\n'
    + '- Source assets: name originals, references, scripts, brand files, audio, images, and any unknown/missing inputs.\n'
    + '- Prompt/spec ledger: preserve the prompt, creative brief, style constraints, negative constraints, and acceptance criteria separately from generated outputs.\n'
    + '- Tool/model metadata: record the generator/editor/model when known, plus settings, date, and version/seed/job IDs if available.\n'
    + '- Variant folder: keep takes/styles/versions distinct, with short notes on what changed and why one was selected.\n'
    + '- Deterministic edit layer: keep exact captions, text overlays, file names, durations, dimensions, and export formats scriptable or explicitly listed.\n'
    + '- Rights and approval: state consent/licensing/credit assumptions, approval status, and who must review before public/client use.\n'
    + '- Final package: list source files, generated takes, edit files, final exports, and the next resume point.\n'
    + '[/MEDIA-PROVENANCE CHECK]';
}

function appendMediaProvenancePrompt(message) {
  const block = mediaProvenancePromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyMediaProvenance,
  mediaProvenancePromptBlock,
  appendMediaProvenancePrompt
};
