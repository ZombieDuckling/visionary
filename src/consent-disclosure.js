'use strict';

// Deterministic consent/disclosure nudge for synthetic identity/media work.
// Inspired by Jake Van Clief's voice-cloning boundary lesson: generated voices,
// faces, likenesses, testimonials, and representative agents need explicit
// consent, disclosure, retention, and misuse review before they become workflow
// automation.

const SYNTHETIC_MEDIA_TERMS = [
  'voice clone', 'voice cloning', 'clone voice', 'cloned voice', 'synthetic voice',
  'ai voice', 'voiceover', 'voice over', 'deepfake', 'deep fake', 'face swap',
  'faceswap', 'avatar', 'digital twin', 'likeness', 'persona video', 'talking head',
  'generated video', 'synthetic media', 'impersonate', 'impersonation'
];

const IDENTITY_TERMS = [
  'identity', 'person', 'client', 'customer', 'employee', 'founder', 'ceo',
  'teacher', 'student', 'patient', 'user', 'influencer', 'celebrity', 'spokesperson',
  'testimonial', 'endorsement', 'name', 'face', 'voice', 'photo', 'portrait'
];

const CONSENT_TERMS = [
  'consent', 'permission', 'approval', 'approved', 'disclosure', 'disclose',
  'label', 'watermark', 'attribution', 'retention', 'delete', 'revocation',
  'withdraw', 'policy', 'rights', 'license', 'legal', 'ethics'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyConsentDisclosure(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const media = countMatches(text, SYNTHETIC_MEDIA_TERMS);
  const identity = countMatches(text, IDENTITY_TERMS);
  const consent = countMatches(text, CONSENT_TERMS);
  const score = (media * 4) + (identity * 2) + consent;

  if (media === 0) {
    return { applies: false, reason: 'no synthetic identity/media signal', score };
  }
  if (identity === 0 && consent === 0) {
    return { applies: false, reason: 'no person/consent boundary signal', score };
  }
  if (consent >= 4) {
    return { applies: false, reason: 'operator already supplied consent/disclosure frame', score };
  }
  if (score < 6) {
    return { applies: false, reason: 'weak consent-disclosure signal', score };
  }

  const layer = text.indexOf('voice clone') !== -1 || text.indexOf('voice cloning') !== -1 || text.indexOf('synthetic voice') !== -1
    ? 'voice-consent-boundary'
    : text.indexOf('deepfake') !== -1 || text.indexOf('face swap') !== -1 || text.indexOf('likeness') !== -1
      ? 'likeness-disclosure-boundary'
      : 'synthetic-identity-boundary';

  return {
    applies: true,
    reason: 'synthetic identity/media work needs consent, disclosure, retention, and misuse boundaries',
    score,
    layer,
    signals: { media, identity, consent }
  };
}

function consentDisclosurePromptBlock(message) {
  const classification = classifyConsentDisclosure(message);
  if (!classification.applies) return '';

  return '[CONSENT + DISCLOSURE CHECK]\n'
    + 'This looks like synthetic voice/likeness/identity media work. Before executing, make consent and disclosure explicit so automation does not blur who is speaking or endorsing.\n'
    + '- Subject authority: name whose voice, face, likeness, name, testimonial, or representative identity is being used, and who can approve it.\n'
    + '- Consent evidence: state whether permission exists, what it covers, expiry/revocation terms, and the safe stop if consent is missing.\n'
    + '- Disclosure surface: specify labels, watermarks, captions, script wording, metadata, or audience notices that reveal AI generation where appropriate.\n'
    + '- Data boundary: keep raw voice/photo/source files, model artifacts, prompts, and exports separate; name retention/deletion rules.\n'
    + '- Misuse review: check impersonation, endorsement, fraud, harassment, reputational, legal, and platform-policy risks before release.\n'
    + 'Keep this proportional, but do not ship identity simulation without an auditable consent/disclosure trail.\n'
    + '[/CONSENT + DISCLOSURE CHECK]';
}

function appendConsentDisclosurePrompt(message) {
  const block = consentDisclosurePromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyConsentDisclosure,
  consentDisclosurePromptBlock,
  appendConsentDisclosurePrompt
};
