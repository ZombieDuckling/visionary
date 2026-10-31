'use strict';

// Deterministic spec-before-the-machine nudge for dispatches that want a
// capability/tool/feature that does not exist yet (or defer design because the
// tooling is not ready), or that should build on prior artifacts. Inspired by
// Jake Van Clief's Engelbart-1962 lesson (video 8MKwd8waj5Q; concept
// spec-before-the-machine): the durable artifact of a capability is its
// specification, not the tool that eventually implements it. Engelbart made the
// word processor realizable in 1962 by describing the behavior — composing
// drafts by rearranging excerpts of old drafts plus new material, with a
// read-back loop — when no such machine existed. The spec came first.
//
// Two primitives matter here: (1) specify the capability before the
// tool/model/vendor exists, in a durable tool-agnostic file, so whoever catches
// up can be measured against the written intent; (2) treat prior artifacts
// (docs, drafts, memory, transcripts) as editable composition material, not a
// read-only archive, so work does not restart from a blank page.
//
// Distinct from augment-over-automate (augment-vs-automate criterion),
// intent-compiler-workbench (folders as portable intent packages),
// spec-component-preview-pipelines (spec-before-expensive-generation), and
// instruction-provenance (whose opinion borrowed instructions carry). This
// fires when a capability looks blocked on tooling parity or when prior work is
// being treated as dead archive.

// Deferral language: design/decision is being held back because the tooling is
// not ready, or a capability is described as not existing yet.
const DEFERRAL_TERMS = [
  "doesn't exist yet", 'does not exist yet', 'no such tool', 'no such feature',
  'not yet supported', 'not supported yet', 'no tool for', 'no support for',
  "the tool can't", "the tool cannot", "the model can't", "the model cannot",
  "the api can't", "the api cannot", "can't do that yet", 'cannot do that yet',
  'not possible yet', 'not available yet', 'not shipped yet', "hasn't shipped",
  'has not shipped', 'future feature', 'wait for', 'waiting for',
  'wait until', 'once the api', 'once the model', 'once the tool',
  'when the api supports', 'until the model', 'until the tool',
  'before the tool', 'before the model', 'not exist yet', 'doesn\u2019t exist yet'
];

// Capability/tooling objects — something that could be built, specified, or
// waited on.
const CAPABILITY_OBJECT_TERMS = [
  'capability', 'capabilities', 'feature', 'tool', 'tools', 'tooling', 'model',
  'api', 'workflow', 'product', 'machine', 'ability', 'integration',
  'pipeline', 'runtime', 'plugin', 'provider', 'agent', 'endpoint', 'service'
];

// Composition-from-prior-corpus language: reusing/rearranging existing work.
const COMPOSITION_TERMS = [
  'reuse', 're-use', 'reusing', 'rearrange', 'rearranging', 'remix',
  'compose from', 'pull from', 'draw on', 'draw from', 'build on prior',
  'build on our prior', 'from prior work', 'from previous work',
  'from existing work', 'prior drafts', 'old drafts', 'existing drafts',
  'previous drafts', 'earlier drafts', 'prior artifacts', 'existing documents',
  'existing material', 'reuse existing', 'reuse our', 'combine existing',
  'rework existing'
];

// Prior-artifact objects: editable composition material.
const ARTIFACT_OBJECT_TERMS = [
  'draft', 'drafts', 'document', 'documents', 'docs', 'notes', 'note',
  'transcript', 'transcripts', 'report', 'reports', 'spec', 'specs',
  'material', 'content', 'writing', 'file', 'files', 'corpus', 'archive',
  'memory', 'wiki', 'page', 'pages', 'work'
];

// Discipline-specific framing terms so an already-established spec frame
// suppresses the nudge. Kept narrow so generic phrasing in other dispatch blocks
// appended earlier in the same prompt cannot silently suppress this check.
const FRAMED_TERMS = [
  'capability spec', 'spec before the machine', 'spec-before-the-machine',
  'spec first', 'spec-first', 'spec the capability', 'specify the capability',
  'write the spec', 'editable context', 'editable composition',
  'composition material', 'prior-artifact composition', 'durable spec',
  'tool-agnostic spec'
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word-boundary matching so short tokens cannot false-match inside other words.
function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    const pattern = new RegExp('\\b' + escapeRegExp(term) + '\\b');
    return pattern.test(text) ? count + 1 : count;
  }, 0);
}

function classifySpecBeforeMachine(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const deferral = countMatches(text, DEFERRAL_TERMS);
  const capability = countMatches(text, CAPABILITY_OBJECT_TERMS);
  const composition = countMatches(text, COMPOSITION_TERMS);
  const artifact = countMatches(text, ARTIFACT_OBJECT_TERMS);
  const framed = countMatches(text, FRAMED_TERMS);
  const score = (deferral * 3) + capability + (composition * 2) + artifact;

  if (framed >= 2) {
    return { applies: false, reason: 'spec-before-the-machine frame already established', score };
  }

  // Deferral + capability object: the capability is blocked on tooling parity.
  if (deferral > 0 && capability > 0) {
    return {
      applies: true,
      reason: 'a capability is being deferred because the tool/model does not exist yet; write the spec first so whoever catches up is measured against the written intent',
      score,
      layer: 'spec-before-machine',
      signals: { deferral, capability, composition, artifact, framed }
    };
  }

  // Composition language + prior-artifact object: prior work as editable context.
  if (composition > 0 && artifact > 0) {
    return {
      applies: true,
      reason: 'prior artifacts are in play; treat them as editable composition material, not a read-only archive, and design the reuse path explicitly',
      score,
      layer: 'prior-artifact-composition',
      signals: { deferral, capability, composition, artifact, framed }
    };
  }

  return { applies: false, reason: 'no spec-deferral or prior-artifact-composition signal', score };
}

function specBeforeMachinePromptBlock(message) {
  const classification = classifySpecBeforeMachine(message);
  if (!classification.applies) return '';

  return '[SPEC-BEFORE-THE-MACHINE CHECK]\n'
    + 'This dispatch wants a capability that does not exist yet, or is building on prior artifacts. The durable artifact of a capability is its specification, not the tool that eventually implements it — do not wait for tooling or model parity before designing. Keep this brief and then continue the task.\n'
    + '- Capability spec: write the capability spec first — target behavior, inputs (including prior artifacts/drafts as editable context), the human read-back/steer point, and the verification that confirms the behavior — as a durable, tool-agnostic file (in the workspace) before choosing a model, vendor, or API.\n'
    + '- Do not wait on tooling: "the tool/model cannot do that yet" is not a reason to leave the capability unspecified. Name the intent early so whoever catches up can build it and be measured against the spec.\n'
    + '- Prior artifacts as editable composition material: design "rearrange prior excerpts + add new material" as a first-class input path, not a blank-page start. Treat docs, drafts, memory, and transcripts as editable context, not a read-only archive.\n'
    + '- Name the read-back/revise step: inspection of prior output must be a designed stage that feeds new considerations, not an implicit retry.\n'
    + '- Measure against written intent: judge realization against the spec, not the vendor\'s shipped feature list — if a tool delivers only a fraction, show the gap.\n'
    + '- Verdict: state whether this has a durable capability spec with prior artifacts as editable context and a read-back stage, versus being blocked on tooling parity or restarting from a blank page.\n'
    + '[/SPEC-BEFORE-THE-MACHINE CHECK]';
}

function appendSpecBeforeMachinePrompt(message) {
  const block = specBeforeMachinePromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifySpecBeforeMachine,
  specBeforeMachinePromptBlock,
  appendSpecBeforeMachinePrompt
};
