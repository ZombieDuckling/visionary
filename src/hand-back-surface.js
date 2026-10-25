'use strict';

// Deterministic hand-back-surface nudge for requests that design or change a
// surface a person works through — UI, screen, dashboard, form, button, click,
// gesture, onboarding, operator interface. Inspired by Jake Van Clief's
// abstraction-stack lesson (video kmORQGdcvXc, concept abstraction-stack-review
// / augment-over-automate): a user-facing affordance is the visible top layer of
// a compressed stack (data, permissions, model calls, runtime, failure modes),
// and its design decisions were made to hand a capability back to a person. The
// failure mode is treating the surface as the whole system — hiding the lower
// layers until they fail, exposing raw machinery as the interface, or judging
// the surface by machinery/monetizability instead of whether it augments the
// person it hands the capability to.
//
// This is distinct from the augment-over-automate nudge (the disposition: who
// the human is and where they steer) and the augmentation-means nudge (the
// anatomy: artifacts/language/methodology/training). This nudge fires on the
// interface layer itself: the surface that compresses the stack and hands a
// capability back to a person. It is also distinct from interface-boundary-check
// (API/CLI/route contracts), which concerns machine-to-machine boundaries rather
// than a human-facing surface.

const EXPLICIT_SURFACE_TERMS = [
  'ui', 'ux', 'ui/ux', 'user interface', 'user-facing', 'user facing',
  'operator-facing', 'operator facing', 'frontend', 'front-end', 'front end',
  'screen', 'dashboard', 'layout', 'affordance', 'onboarding', 'empty state',
  'wizard', 'sidebar', 'button', 'click', 'gesture', 'end-user', 'end user',
  'user experience', 'interaction', 'nav', 'navigation', 'menu'
];

const IMPLIED_SURFACE_TERMS = [
  'make it easier', 'easier to use', 'make it simpler', 'simpler to use',
  'reduce clicks', 'fewer steps', 'one click', 'self-serve', 'self serve',
  'intuitive', 'just works', 'reduce friction', 'friction', 'streamline',
  'less confusing', 'clearer'
];

const NAMES_FRAME_TERMS = [
  'hand-back', 'hand back', 'handback', 'hand-back line', 'hand back line',
  'lower layer', 'lower-layer', 'layers beneath', 'compressed stack',
  'stack', 'provenance', 'failure mode', 'failure-mode', 'permission boundary',
  'rollback', 'what the person sees', 'what the user sees', 'user sees',
  'operator sees', 'affordance decision', 'click-path', 'click path'
];

// Word-boundary matching: short tokens like 'ui', 'ux', 'nav', 'menu' must not
// match as substrings of unrelated words ('build', 'quick', 'continue', ...).
function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(^|[^a-z0-9])' + escaped + '([^a-z0-9]|$)');
    return re.test(text) ? count + 1 : count;
  }, 0);
}

function classifyHandBackSurface(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const explicit = countMatches(text, EXPLICIT_SURFACE_TERMS);
  const implied = countMatches(text, IMPLIED_SURFACE_TERMS);
  const framed = countMatches(text, NAMES_FRAME_TERMS);

  if (explicit === 0 && implied === 0) {
    return { applies: false, reason: 'not a human-surface request', score: 0 };
  }
  if (framed >= 2) {
    return { applies: false, reason: 'hand-back surface already framed', score: explicit + implied };
  }

  const layer = explicit >= 1
    ? 'explicit-surface'
    : 'implied-surface';

  return {
    applies: true,
    reason: 'a person-facing surface is being designed or changed; name who the capability is handed back to, the stack it hides, the deliberate affordance decisions, and the hand-back line before treating the surface as done',
    score: explicit * 2 + implied,
    layer,
    signals: { explicit: explicit, implied: implied, framed: framed }
  };
}

function handBackSurfacePromptBlock(message) {
  const classification = classifyHandBackSurface(message);
  if (!classification.applies) return '';

  return '[HAND-BACK SURFACE CHECK]\n'
    + 'This request designs or changes a surface a person works through. A user-facing affordance is the visible top of a compressed stack, and the stack exists to hand a capability back to a person. Keep raw machine complexity below the hand-back line and expose only the augmented human workflow. Before building or judging it, answer these:\n'
    + '- Who the capability is handed back to: name the person/role and the capability they gain (faster search, safer edit, clearer next action), not just the machinery being connected.\n'
    + '- The stack the surface hides: the data, permissions, model calls, failure modes, and operational state beneath the surface the person never sees but depends on. Do not read a simple gesture as a simple system.\n'
    + '- The deliberate affordance decisions: which action is surfaced, how (one click, default, shortcut), and what is intentionally kept behind the line — state why each affordance was chosen.\n'
    + '- The hand-back line: what the person sees and controls (status, next action, artifacts, errors, rollback) versus what stays internal machinery. Exposing raw plumbing as the interface is the failure mode.\n'
    + '- Failure visibility: how the surface shows a broken or uncertain lower layer to the person, and the recovery path.\n'
    + '- Judgement: assess the surface by whether it augments the person it hands the capability to — not by machinery sophistication, automation count, or monetizability.\n'
    + '[/HAND-BACK SURFACE CHECK]';
}

function appendHandBackSurfacePrompt(message) {
  const block = handBackSurfacePromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyHandBackSurface,
  handBackSurfacePromptBlock,
  appendHandBackSurfacePrompt
};
