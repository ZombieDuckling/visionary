'use strict';

// Deterministic interface-layer selection nudge for requests that propose
// choosing or standing up an AI tool/interface to do a job — "use Claude to
// browse…", "build an agent", "connect it to our API", "set up a terminal
// workflow", "which model should we use", "spin up a custom orchestration".
// Inspired by Jake Van Clief's interface-layer lesson (videos rHDA0WMXzy4,
// 0fCQ-4J_jzk, ozkx_eUfjY0): do not choose an AI tool by brand, hype, or
// "agent" language first — choose by the access layer the job needs. What can
// the model see, edit, run, persist, or expose? A chat box is a conversation
// layer; a file/IDE/terminal agent is an action layer; a hosted co-work
// environment is a managed workspace layer; a custom API swarm is only
// justified when no simpler layer can satisfy the job. State that must persist
// belongs in files (manifests, notes, tests, commits), not in chat scrollback,
// and public deployables must be separated from private context and secrets.
//
// Visionary already carries this as a concept note in the knowledge repo
// (concepts/ai-interface-layer-selection.md) and exposes many runtimes
// (src/runtimes/), but nothing applied it at dispatch time. This nudge makes
// the operator's agents name the access need and the simplest sufficient layer
// before anchoring work in a tool.
//
// This is the *interface-layer selection* layer. Distinct from
// runtime-reach-portability (fires once a runtime is already named, on reach
// gaps and vendor-independence pressure), automation-timing (whether and how
// far to automate a step), workflow-resilience (provider outage/quota/
// degradation), and source-runtime-value (source-code/import work).

const TOOL_TERMS = [
  'tool', 'tools', 'model', 'models', 'runtime', 'runtimes', 'harness',
  'agent', 'agents', 'agentic', 'orchestration', 'multi-agent', 'multi agent',
  'mcp', 'connector', 'integration', 'assistant', 'copilot', 'chatbot',
  'plugin', 'extension', 'co-work', 'cowork', 'desktop app', 'ide agent',
  'file agent', 'terminal agent', 'cli agent'
];

// The access the job actually needs the layer to provide: see, edit, run,
// persist, or expose (permissions/secrets/deploy/collaboration).
const ACCESS_TERMS = [
  'see', 'read', 'edit', 'write', 'run', 'runs', 'execute', 'browse', 'browser',
  'web', 'url', 'internet', 'online', 'files', 'file', 'folder', 'folders',
  'repo', 'repository', 'codebase', 'database', 'db', 'api', 'webhook',
  'persist', 'persistent', 'save', 'store', 'state', 'survive', 'deploy',
  'production', 'permissions', 'permission', 'secret', 'secrets', 'credentials',
  'token', 'keys', 'collaborate', 'collaboration', 'multi-user', 'shared',
  'audit', 'isolate', 'isolation', 'sandbox', 'tests', 'terminal', 'command'
];

// A choice/build/use verb — the request is deciding on a tool, not just
// describing one.
const CHOICE_TERMS = [
  'which tool', 'which model', 'which runtime', 'which harness', 'which layer',
  'which one', 'what tool', 'what model', 'what runtime', 'what harness',
  'best tool', 'best model', 'best way', 'choose', 'pick', 'select',
  'should we use', 'should i use', 'set up', 'setup', 'stand up', 'spin up',
  'build', 'use', 'connect', 'wire', 'integrate', 'switch to', 'move to',
  'custom', 'replace'
];

// Signals the operator already named the layer and its access rationale, so the
// nudge steps back rather than nagging.
const LAYER_FRAME_TERMS = [
  'ide agent', 'file agent', 'terminal agent', 'cli agent', 'access layer',
  'simplest layer', 'cheapest layer', 'managed workspace', 'hosted co-work',
  'hosted cowork', 'custom orchestration', 'no custom', 'plain chat',
  'conversation layer', 'action layer', 'permissions boundary', 'secret boundary',
  'public artifact', 'private context', 'routing state', 'route state'
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-word matching (not naive substring) so short terms such as "run",
// "see", "web", and "db" cannot false-match inside longer words.
function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    const pattern = new RegExp('\\b' + escapeRegExp(term) + '\\b');
    return pattern.test(text) ? count + 1 : count;
  }, 0);
}

function classifyInterfaceLayerSelection(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const tool = countMatches(text, TOOL_TERMS);
  const access = countMatches(text, ACCESS_TERMS);
  const choice = countMatches(text, CHOICE_TERMS);
  const layerFrame = countMatches(text, LAYER_FRAME_TERMS);
  const score = (tool * 2) + (access * 3) + (choice * 2) - (layerFrame * 3);

  // Need a tool/interface choice: a tool term plus a concrete access need, with
  // a choice/build verb (or several tool terms) making it a real decision.
  if (tool === 0) {
    return { applies: false, reason: 'no tool/model/runtime/agent named', score };
  }
  if (access === 0) {
    return { applies: false, reason: 'tool named without a concrete access need', score };
  }
  if (layerFrame >= 2) {
    return { applies: false, reason: 'operator already named the layer and its access need', score };
  }
  if (choice === 0 && tool < 2) {
    return { applies: false, reason: 'descriptive mention, not a tool-choice request', score };
  }
  if (access < 2 && choice < 2) {
    return { applies: false, reason: 'weak interface-layer signal', score };
  }
  if (score < 9) {
    return { applies: false, reason: 'weak interface-layer signal', score };
  }

  const layer = access >= 3
    ? 'access-boundary-check'
    : 'layer-selection-check';

  return {
    applies: true,
    reason: 'choose an interface layer by the access the job needs — name the access need, pick the simplest sufficient layer, and route durable state out of chat',
    score,
    layer,
    signals: { tool: tool, access: access, choice: choice, layer_frame: layerFrame }
  };
}

function interfaceLayerPromptBlock(message) {
  const classification = classifyInterfaceLayerSelection(message);
  if (!classification.applies) return '';

  return '[INTERFACE-LAYER CHECK]\n'
    + 'This request proposes choosing or standing up an AI tool/interface for a job. Choose by the access layer the job needs, not by brand, hype, or "agent" language.\n'
    + '- Access need: name what the job actually needs the layer to do \u2014 see (web/URL/connector), edit (files/repo), run (commands/tests), persist (durable state), or expose (API/webhook/secret/collaboration).\n'
    + '- Simplest sufficient layer: recommend the lowest layer that completes and verifies the job \u2014 plain chat/desktop for ideation; a file/IDE agent for repo edits and tests; a terminal/CLI agent for batch file/command work; a deterministic script for repeatable transforms; hosted co-work only for a managed-workspace need; a custom orchestration/multi-agent runtime only when no simpler layer can satisfy permissions, scaling, audit, isolation, or integration.\n'
    + '- State routing: if the work must survive the conversation, write it to durable files (manifest, notes/CLAUDE.md, index, PRD, tests, commits, runbook) instead of leaving it in chat scrollback.\n'
    + '- Secret and visibility boundary: separate public artifacts (deployable code/site) from private context (transcripts, client research, memory, prompts, secrets); name what needs permissions/secrets/deploy/collaboration and what stays local.\n'
    + '- Versioning: if the artifact will evolve, put it under git rather than one-off downloads and reuploads.\n'
    + '- Verdict: state the chosen layer, the named access need, and what stays a human judgment point.\n'
    + '[/INTERFACE-LAYER CHECK]';
}

function appendInterfaceLayerPrompt(message) {
  const block = interfaceLayerPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyInterfaceLayerSelection,
  interfaceLayerPromptBlock,
  appendInterfaceLayerPrompt
};
