'use strict';

// Deterministic secret-isolation nudge for dispatches that handle a secret —
// an API key, token, password, credential, signing key, or webhook secret.
// Inspired by Jake Van Clief's prompt-and-memory-hierarchy lesson
// (concept `prompt-and-memory-hierarchy`; videos S3fXSc5z2n4, 5B6W2OGfxq0):
// prompting is context programming, and once instructions, evidence, generated
// output, credentials, and raw documents are flattened into one token stream,
// reliability depends on restoring the boundaries the model cannot keep for
// itself — "separate instructions, evidence, outputs, and credentials" and
// "validate at boundaries". The durable principle is that a secret belongs in a
// store (env/keychain/vault/secret manager), not in a prompt, an artifact, a
// log, or a commit.
//
// The failure mode this prevents is credential leakage from an otherwise
// successful run: an agent that pastes a key into its prompt, writes the raw
// value into a report or the task workdir, prints it to a log, or commits a
// `.env`. Visionary is local-first and dispatches agents through CLI harnesses,
// so a leaked key is one `git push` away from being public. This nudge makes the
// operator's agents name the secret, its store, its scope, and its boundaries,
// then verify no secret leaked before claiming done.
//
// This is the *credential/secret* boundary layer. Distinct from context-boundary
// (source-trust and validation for any untrusted text/evidence), interface-
// boundary-check (the API/CLI/tool contract: inputs, outputs, failure behavior),
// consent-disclosure (whether a person's data may be processed at all), and
// production-readiness (go-live operational readiness). It fires on the narrow
// case where a *secret value* is in scope for the job.

// A strong signal: the term is almost always a secret, not a generic word.
const STRONG_SECRET_TERMS = [
  'secret', 'secrets', 'credential', 'credentials', 'api key', 'api-key',
  'apikey', 'password', 'passwords', 'passphrase', 'private key', 'access key',
  'client secret', 'signing key', 'encryption key', 'keychain', 'vault',
  'webhook secret', 'bearer', 'oauth', 'secret manager'
];

// A weak signal: often a secret, but also a generic word in AI/product work
// ("token budget", "auth flow"). Only counts when paired with other signals.
const WEAK_SECRET_TERMS = [
  'token', 'tokens', 'env', 'environment variable', 'environment variables',
  'dotenv', 'auth', 'authorization'
];

// The dispatch is doing something with the secret — reading, passing, storing,
// sending, signing, configuring.
const HANDLING_TERMS = [
  'use', 'uses', 'load', 'loads', 'read', 'reads', 'store', 'stores', 'save',
  'pass', 'passes', 'send', 'sends', 'inject', 'injects', 'write', 'writes',
  'share', 'shares', 'configure', 'set up', 'connect', 'sign', 'signs',
  'rotate', 'mask', 'protect', 'hide', 'manage', 'wire up', 'authenticate'
];

// The dispatch touches a boundary where a secret could leak.
const RISK_TERMS = [
  'leak', 'leaks', 'expose', 'exposes', 'exposed', 'hardcode', 'hard-code',
  'hardcoded', 'plaintext', 'plain text', 'in chat', 'in the prompt',
  'public', 'commit', 'commits', 'push', 'log', 'logs', 'artifact', 'artifacts',
  'output', 'outputs', 'git', 'repo', 'repository'
];

// The operator already framed the secret's isolation, so the nudge steps back.
// Only unambiguous framing counts (a bare "from env" is too weak to suppress).
const FRAME_TERMS = [
  'secret isolation', 'secret-isolated', 'secret isolated', 'least privilege',
  'keep out of', 'no secrets', 'credentials isolated', 'scoped credentials',
  'vault-backed', 'secret manager', 'no secret in', 'reference by name'
];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-word matching (not naive substring) so short terms such as "auth",
// "env", and "use" cannot false-match inside longer words.
function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    const pattern = new RegExp('\\b' + escapeRegExp(term) + '\\b');
    return pattern.test(text) ? count + 1 : count;
  }, 0);
}

function classifySecretIsolation(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const strong = countMatches(text, STRONG_SECRET_TERMS);
  const weak = countMatches(text, WEAK_SECRET_TERMS);
  const handling = countMatches(text, HANDLING_TERMS);
  const risk = countMatches(text, RISK_TERMS);
  const frame = countMatches(text, FRAME_TERMS);
  const score = (strong * 4) + (weak * 1) + (handling * 2) + (risk * 2) - (frame * 3);

  if (frame >= 2) {
    return { applies: false, reason: 'operator already framed the secret isolation', score };
  }
  // Require an unambiguous secret term, or a weak term reinforced by a handling
  // and a boundary-risk signal — so "reduce token usage" alone does not fire.
  const hasSecret = strong >= 1 || (weak >= 1 && handling >= 1 && risk >= 1);
  if (!hasSecret) {
    return { applies: false, reason: 'no secret/credential in scope', score };
  }
  if (score < 6) {
    return { applies: false, reason: 'weak secret-isolation signal', score };
  }

  const layer = risk >= 2
    ? 'secret-boundary-review'
    : strong >= 2 || handling >= 2
      ? 'secret-scope-review'
      : 'secret-in-scope-check';

  return {
    applies: true,
    reason: 'keep the secret out of the prompt, artifacts, logs, and git; name its store and scope',
    score,
    layer,
    signals: { strong: strong, weak: weak, handling: handling, risk: risk, frame: frame }
  };
}

function secretIsolationPromptBlock(message) {
  const classification = classifySecretIsolation(message);
  if (!classification.applies) return '';

  return '[SECRET ISOLATION REVIEW]\n'
    + 'This dispatch handles a secret (credential/api key/token/password/key). Keep it isolated from prompts, artifacts, logs, and git.\n'
    + '- Secret in scope: name exactly which secret(s) the job uses and where each lives (env, keychain, vault, secret manager) — never hardcoded in source, config, or the prompt.\n'
    + '- Prompt/chat boundary: the raw secret value must not be pasted into the agent prompt or chat transcript; pass it through the environment/tool/connector and reference it by name.\n'
    + '- Artifact boundary: no secret may be written into deliverables, reports, logs, or the task workdir; redact/mask the value wherever it must appear.\n'
    + '- Git boundary: secrets must never land in committed files — check .gitignore and `git status`/diff before committing; ship `.env.example` (with placeholders), never `.env`.\n'
    + '- Scope / least privilege: grant only the scope the job needs; prefer read-only or short-lived credentials over broad long-lived ones; name rotation/revocation and who holds the secret.\n'
    + '- Verification: before claiming done, confirm no leak — grep the produced artifacts and the diff for the key value, and confirm the secret was read from its store rather than inlined.\n'
    + '- Verdict: secret-isolated (named store, out of prompt/artifact/log/git, least-privilege scope) vs. secret-exposed risk (unknown source, secret in prompt/artifact/git, or over-broad scope).\n'
    + '- Keep it proportional: a one-line "secret X comes from Y and never touches Z" is enough for a small job.\n'
    + '[/SECRET ISOLATION REVIEW]';
}

function appendSecretIsolationPrompt(message) {
  const block = secretIsolationPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifySecretIsolation,
  secretIsolationPromptBlock,
  appendSecretIsolationPrompt
};
