'use strict';

// Deterministic vibe-coded-software-audit nudge for dispatches that review,
// harden, or ship AI-generated software — "audit my app", "is this safe to
// ship", "review the code", "vibe coded", "check for secrets", "harden it
// before launch". Inspired by Jake Van Clief's vibe-coded-software-audit
// concept (video nWbM9Ye2sLw and the related Open Claw reviews): a working app is
// not evidence that secrets, auth, route exposure, deployment config, and
// generated planning artifacts are safe. A green build is not a security signal,
// and code-only review misses Git/tool/deployment history and business context.
//
// This is distinct from review-debt (did the change get real verification at
// all), execution-evidence-gate (was a run's output actually checked), and
// interface-boundary-check (machine-to-machine contracts). Those ask whether the
// work was verified; this asks whether software that an AI wrote is safe to
// trust with data, access, and launch. src/production-readiness.js#vibeCodedAudit
// is the deterministic gate set; this nudge is the dispatch-time prompt that
// makes the operator's coding agents actually run those gates.

const AUDIT_INTENT_TERMS = [
  'audit', 'security review', 'security audit', 'security check', 'pen test',
  'pentest', 'pen-test', 'code review', 'review the code', 'review the codebase',
  'review the app', 'review my app', 'review the repo', 'review the site',
  'safe to ship', 'safe to launch', 'safe to deploy', 'ready to ship',
  'ready to launch', 'ready to deploy', 'ship it', 'go live', 'go-live',
  'before launch', 'before shipping', 'pre-launch', 'prelaunch', 'pre launch',
  'harden', 'harden it', 'lock down', 'lock it down', 'check for secrets',
  'secret scan', 'secrets', 'leak', 'leaks', 'leaked', 'trust', 'trustworthy',
  'can i trust', 'is this safe', 'production ready', 'production-ready',
  'threat model', 'attack surface'
];

const SOFTWARE_CONTEXT_TERMS = [
  'app', 'application', 'codebase', 'code base', 'repo', 'repository',
  'website', 'web site', 'site', 'web app', 'webapp', 'code', 'source',
  'prototype', 'mvp', 'scaffold', 'scaffolded', 'generated', 'ai-generated',
  'ai generated', 'backend', 'back-end', 'frontend', 'front-end', 'api',
  'service', 'endpoint', 'controller', 'route', 'routes', 'server', 'database',
  'it', 'this', 'software'
];

// A bare "vibe" token is strong enough on its own to imply AI-generated software.
const VIBE_TERMS = [
  'vibe code', 'vibe-code', 'vibe coded', 'vibe-coded', 'vibecode',
  'vibecoded', 'vibecoding', 'vibe-coding', 'vibe engineering'
];

// If several of these are already present, the operator (or the agent) has
// already framed the audit gates, so we should not nag.
const FRAMED_TERMS = [
  'secret scan', 'scan for secrets', 'git history', 'history', 'provider',
  'deployment', 'deploy config', 'route map', 'public route', 'public routes',
  'allowed methods', 'auth', 'authentication', 'authorization', 'session',
  'managed sdk', 'threat model', 'audit gate', 'audit gates', 'audit trail',
  'generated artifact', 'generated artifacts', 'prompt files', 'task plans',
  'vibe-coded audit', 'vibe coded audit', 'threat modeling', 'rollback',
  'blast radius', 'cors'
];

// Word-boundary matching: short tokens like 'it', 'app', 'api', 'auth' must not
// match as substrings of unrelated words ('item', 'apparent', 'apitome', ...).
function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(^|[^a-z0-9])' + escaped + '([^a-z0-9]|$)');
    return re.test(text) ? count + 1 : count;
  }, 0);
}

function classifyVibeCodedAudit(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const auditIntent = countMatches(text, AUDIT_INTENT_TERMS);
  const softwareContext = countMatches(text, SOFTWARE_CONTEXT_TERMS);
  const vibe = countMatches(text, VIBE_TERMS);
  const framed = countMatches(text, FRAMED_TERMS);

  // Strong signal: an explicit vibe-coded/ai-generated token plus software.
  if (vibe === 0 && !(auditIntent >= 1 && softwareContext >= 1)) {
    return { applies: false, reason: 'not a software-audit request', score: auditIntent + softwareContext };
  }
  if (framed >= 2) {
    return { applies: false, reason: 'vibe-coded audit already framed', score: auditIntent + softwareContext + vibe };
  }

  const layer = vibe >= 1
    ? 'explicit-vibe-coded'
    : 'implied-software-audit';

  return {
    applies: true,
    reason: 'software that an AI wrote is being reviewed, hardened, or shipped; a green build is not a security signal, so run the current-file scan, history/deployment review, managed-auth check, public route map, generated-artifact review, provider boundary, and human threat model before trusting it',
    score: auditIntent * 2 + softwareContext + vibe * 3,
    layer,
    signals: { auditIntent, softwareContext, vibe, framed }
  };
}

function vibeCodedAuditPromptBlock(message) {
  const classification = classifyVibeCodedAudit(message);
  if (!classification.applies) return '';

  return '[VIBE-CODED SOFTWARE AUDIT]\\n'
    + 'This request reviews, hardens, or ships software that an AI wrote. A working app is not evidence that secrets, auth, route exposure, deployment configuration, and generated planning artifacts are safe. Do not stop at tests or static checks; answer these before trusting or shipping it:\\n'
    + '- Secrets and key history: scan current files for keys/tokens/secrets, search Git/tool/deployment history for deleted secrets, rotate anything that touched an AI tool, chat, repo push, or public log, and record any history you could not inspect as a limitation.\\n'
    + '- Managed auth/security primitives: prefer official provider SDK/session APIs; flag hand-rolled JWT validation, crypto, session stores, password handling, webhook validation, and permission systems, and verify issuer/audience/project checks.\\n'
    + '- Public/private route boundaries: enumerate public routes and allowed methods (including GET/POST/PUT and webhooks), confirm the auth behavior each expects, and test that mission-control/admin/ops/client data endpoints are not accidentally exposed; check CORS, callbacks, and health checks.\\n'
    + '- Generated artifacts reviewed as context: read task plans, prompt files, markdown, and execution logs for ambiguous instructions like "build authentication" or "create encryption" that caused weak implementations, and correct or quarantine unsafe instructions before another agent reads them.\\n'
    + '- External provider/deployment boundary: check provider/deployment configuration and vendor warnings where reachable, or state the limitation explicitly.\\n'
    + '- Human threat model: ask what a malicious user, competitor, or accidental client could do with the current interface and business context code-only tools cannot infer; decide what must be fixed before launch versus accepted as known risk.\\n'
    + '- Report: produce a risk report with current-file findings, unresolved limitations, auth/provider assessment, the public route map, generated-doc/task risks, fixes made or recommended, and the exact verification commands and results.\\n'
    + '[/VIBE-CODED SOFTWARE AUDIT]';
}

function appendVibeCodedAuditPrompt(message) {
  const block = vibeCodedAuditPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\\n\\n' + block;
}

module.exports = {
  classifyVibeCodedAudit,
  vibeCodedAuditPromptBlock,
  appendVibeCodedAuditPrompt
};
