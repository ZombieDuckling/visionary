# Secret Isolation Review Guide

When a Visionary dispatch handles a **secret** — an API key, token, password, credential, signing key, or webhook secret — the secret belongs in a store (environment, keychain, vault, or secret manager), not in a prompt, an artifact, a log, or a commit.

This is Jake Van Clief's prompt-and-memory-hierarchy lesson (`S3fXSc5z2n4`, `5B6W2OGfxq0`): prompting is context programming, and once instructions, evidence, generated output, credentials, and raw documents are flattened into one token stream, reliability depends on restoring the boundaries the model cannot keep for itself. The operating rule is *separate instructions, evidence, outputs, and credentials*, and *validate at boundaries*.

Use this guide when a request, brief, or dispatch touches a credential — "wire up the API", "connect to the service", "load the key", "send the webhook", "auth to the endpoint".

## Review steps

1. **Name the secret and its store.** Which secret(s) does the job use, and where does each live? A store — env var, macOS keychain, vault, or secret manager — never hardcoded in source, config, or the prompt.
2. **Prompt/chat boundary.** The raw value must not be pasted into the agent prompt or the chat transcript; pass it through the environment/tool/connector and reference it by name.
3. **Artifact boundary.** No secret may be written into deliverables, reports, logs, or the task workdir; redact or mask the value wherever it must appear.
4. **Git boundary.** Secrets must never land in committed files — check `.gitignore` and `git status`/diff before committing; ship `.env.example` with placeholders, never `.env`.
5. **Scope and least privilege.** Grant only the scope the job needs; prefer read-only or short-lived credentials over broad, long-lived ones; name rotation/revocation and who holds the secret.
6. **Verification.** Before claiming done, confirm no leak — grep the produced artifacts and the diff for the key value, and confirm the secret was read from its store rather than inlined.
7. **Verdict.** Secret-isolated (named store, out of prompt/artifact/log/git, least-privilege scope) versus secret-exposed risk (unknown source, secret in prompt/artifact/git, or over-broad scope).

## Why this is a product reliability control

Visionary is local-first and dispatches agents through CLI harnesses that write files into a per-task workdir and produce artifacts visible in the UI. That is exactly the surface where a credential leaks: an agent pastes a key into its prompt, writes the raw value into a report, prints it to a log, or commits a `.env`. Treating the secret boundary as part of the dispatch (not a hope) keeps keys out of public repos and client deliverables.

## Anti-patterns

- Hardcoding a key in source or config instead of reading it from a store.
- Pasting a raw secret into the prompt or chat transcript.
- Writing the raw value into a report, log, or the task workdir.
- Committing a `.env` (or any file with a real key) instead of `.env.example`.
- Granting a broad, long-lived credential when a read-only or short-lived one would do.
- Claiming a run succeeded without checking that the secret did not leak into its artifacts.

## Relationship to other controls

- **context-boundary** — source-trust and validation for any untrusted text/evidence; this control is the narrower credential case.
- **interface-boundary-check** — the API/CLI/tool contract (inputs, outputs, failure behavior); this control is about the secret value crossing that interface.
- **consent-disclosure** — whether a person's data may be processed at all; this control is about how the credential is handled.
- **production-readiness** — go-live operational readiness; this control is one security-shaped gate inside it.
