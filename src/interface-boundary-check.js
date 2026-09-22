'use strict';

// Deterministic interface-boundary nudge for API/CLI/integration work.
// Inspired by Jake Van Clief's abstraction/interface/verification cluster:
// useful systems expose explicit contracts, isolate secrets, and verify at
// layer boundaries instead of trusting model confidence or hidden prompts.

const INTERFACE_TERMS = [
  'api', 'apis', 'endpoint', 'endpoints', 'webhook', 'integration', 'integrations',
  'cli', 'command', 'adapter', 'sdk', 'mcp', 'tool', 'tools', 'service', 'contract',
  'schema', 'protocol', 'import', 'export', 'connector', 'route', 'routes'
];

const BOUNDARY_TERMS = [
  'input', 'inputs', 'output', 'outputs', 'request', 'response', 'payload',
  'permission', 'permissions', 'auth', 'credential', 'credentials', 'secret',
  'secrets', 'token', 'tokens', 'scope', 'scopes', 'access', 'private', 'public'
];

const VERIFICATION_TERMS = [
  'verify', 'verified', 'verification', 'test', 'tests', 'smoke', 'validate',
  'validation', 'read-back', 'read back', 'audit', 'logs', 'trace', 'error',
  'errors', 'fallback', 'retry', 'idempotent', 'status', 'healthcheck'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyInterfaceBoundaryCheck(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const interfaceMatches = countMatches(text, INTERFACE_TERMS);
  const boundaryMatches = countMatches(text, BOUNDARY_TERMS);
  const verificationMatches = countMatches(text, VERIFICATION_TERMS);
  const score = (interfaceMatches * 3) + (boundaryMatches * 2) + (verificationMatches * 2);

  if (interfaceMatches === 0) {
    return { applies: false, reason: 'no interface/API/tool signal', score };
  }
  if (boundaryMatches === 0 && verificationMatches === 0) {
    return { applies: false, reason: 'no boundary or verification signal', score };
  }
  if (score < 7) {
    return { applies: false, reason: 'weak interface-boundary signal', score };
  }

  const layer = boundaryMatches >= 3 || text.indexOf('secret') !== -1 || text.indexOf('permission') !== -1
    ? 'permission-and-secret-boundary'
    : verificationMatches >= 3 || text.indexOf('healthcheck') !== -1 || text.indexOf('read-back') !== -1 || text.indexOf('read back') !== -1
      ? 'verification-boundary'
      : 'contract-boundary';

  return {
    applies: true,
    reason: 'interface work needs explicit contracts, secret isolation, and boundary verification',
    score,
    layer,
    signals: {
      interface: interfaceMatches,
      boundary: boundaryMatches,
      verification: verificationMatches
    }
  };
}

function interfaceBoundaryCheckPromptBlock(message) {
  const classification = classifyInterfaceBoundaryCheck(message);
  if (!classification.applies) return '';

  return '[INTERFACE BOUNDARY CHECK]\n'
    + 'This looks like API/CLI/tool/integration work where the layer boundary matters. Before finishing, make the interface contract explicit and verify it instead of relying on prompt confidence.\n'
    + '- Contract surface: name the exact endpoint, command, route, schema, file, or adapter boundary being used or changed.\n'
    + '- Inputs and outputs: specify required inputs, produced outputs, status/error shapes, and what is deliberately not handled.\n'
    + '- Permission and secret boundary: keep credentials/tokens/private keys outside workbench artifacts; name required scopes without exposing values.\n'
    + '- Boundary verification: include the smallest read-back, smoke test, schema check, healthcheck, or log trace that proves the contract works.\n'
    + '- Failure mode: state the fallback, retry/idempotency behavior, or safe stop if the lower layer/API/tool returns bad data or fails.\n'
    + 'Keep this proportional; do not over-design a tiny helper, but do not hide contract assumptions inside prose.\n'
    + '[/INTERFACE BOUNDARY CHECK]';
}

function appendInterfaceBoundaryCheckPrompt(message) {
  const block = interfaceBoundaryCheckPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyInterfaceBoundaryCheck,
  interfaceBoundaryCheckPromptBlock,
  appendInterfaceBoundaryCheckPrompt
};
