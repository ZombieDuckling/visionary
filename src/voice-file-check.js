'use strict';

// Deterministic voice-file nudge for content and communication work.
// Inspired by Jake Van Clief's voice-file lesson: brand/user voice should live
// in small project-local source files with examples and deterministic lintable
// rules, not in vague adjectives or hidden chat memory.

const CONTENT_TERMS = [
  'copy', 'content', 'draft', 'rewrite', 'write', 'edit', 'email', 'post', 'caption',
  'newsletter', 'landing page', 'webpage', 'homepage', 'sales page', 'proposal',
  'announcement', 'blog', 'article', 'script', 'voiceover', 'message', 'outreach'
];

const VOICE_TERMS = [
  'voice', 'tone', 'style', 'brand', 'sound like', 'sounds like', 'persona',
  'personality', 'punchy', 'polished', 'human', 'authentic', 'casual', 'formal',
  'josh', 'founder', 'customer-facing', 'client-facing'
];

const SOURCE_TERMS = [
  'voice file', 'style guide', 'brand guide', 'examples', 'sample', 'samples',
  'reference', 'references', 'lint', 'checklist', 'rules', 'rubric', 'forbidden',
  'banned', 'must avoid', 'do and don\'t', 'dos and don\'ts'
];

const PURE_TECH_TERMS = [
  'refactor', 'schema', 'database', 'sqlite', 'api route', 'unit test', 'compile',
  'dependency', 'docker', 'port', 'server', 'endpoint'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyVoiceFileCheck(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const content = countMatches(text, CONTENT_TERMS);
  const voice = countMatches(text, VOICE_TERMS);
  const source = countMatches(text, SOURCE_TERMS);
  const pureTech = countMatches(text, PURE_TECH_TERMS);
  const score = (content * 2) + (voice * 3) + (source * 2) - (pureTech * 2);

  if (content === 0) {
    return { applies: false, reason: 'no content/drafting signal', score };
  }
  if (voice === 0 && source < 2) {
    return { applies: false, reason: 'content request lacks voice/source signal', score };
  }
  if (pureTech > 0 && voice === 0) {
    return { applies: false, reason: 'technical work without voice requirements', score };
  }
  if (score < 7) {
    return { applies: false, reason: 'weak voice-file signal', score };
  }

  const layer = source >= 3 || text.indexOf('voice file') !== -1 || text.indexOf('style guide') !== -1
    ? 'explicit-voice-source'
    : voice >= 3
      ? 'voice-sensitive-draft'
      : 'content-style-check';

  return {
    applies: true,
    reason: 'voice-sensitive content needs local source examples and deterministic style checks',
    score,
    layer,
    signals: { content, voice, source, pureTech }
  };
}

function voiceFileCheckPromptBlock(message) {
  const classification = classifyVoiceFileCheck(message);
  if (!classification.applies) return '';

  return '[VOICE-FILE CHECK]\n'
    + 'This is voice-sensitive content work. Before finalizing, anchor the draft to local voice source material instead of vague style adjectives.\n'
    + '- Voice source: name the project-local VOICE.md, style guide, examples, prior approved drafts, or say plainly that none exists yet.\n'
    + '- Concrete examples: use real snippets or pass/fail examples when available; do not rely only on labels like punchy, polished, human, or on-brand.\n'
    + '- Deterministic checks: list exact lintable rules such as forbidden phrases, punctuation, required sections, formatting, claims, or disclosure lines.\n'
    + '- Human judgment: separate subjective taste review from exact lint checks; a style script is not a quality score.\n'
    + '- Durable correction: if the same voice correction appears again, propose updating the voice file or lint checklist with a dated note.\n'
    + 'Keep this proportional; produce the requested content and leave the next draft easier to make consistent.\n'
    + '[/VOICE-FILE CHECK]';
}

function appendVoiceFileCheckPrompt(message) {
  const block = voiceFileCheckPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyVoiceFileCheck,
  voiceFileCheckPromptBlock,
  appendVoiceFileCheckPrompt
};