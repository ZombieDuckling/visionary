'use strict';

// Deterministic runtime-reach / vendor-independence nudge for requests that
// bind a workflow to a named AI runtime/vendor and depend on what that runtime
// can *reach* (web, connectors, files, tools, APIs). Inspired by Jake Van
// Clief's cross-runtime brief replay lesson (video 49YDUZD2kSI, "agents are just
// a naming convention"): the Dubai worked example — one person wrote a brief
// with Claude, Claude could not reach the government website it needed, and
// somebody on a completely different team ran the exact same brief in ChatGPT
// and it worked. "The part worth owning was the instructions the whole time."
// Reach is per-runtime; a reach failure on one model is not a workflow failure.
// The same source also cites Gartner: up to 70% of companies will walk away
// from the agents vendors built for them by 2028 — the churn is in the
// vendor-branded wrapper, not the instructions. Visionary should force the
// reach requirement and a fallback runtime to be named before a workflow is
// treated as done or a business is anchored to one vendor's agent layer.
//
// This is the *reach + vendor-binding* layer. Distinct from
// portable-instruction-asset (fires on workflow/wrapper buildout and owning the
// instruction asset), workflow-resilience (fires on provider outage/quota/
// degradation), and source-runtime-value (fires on source-code/import work).
// This nudge fires specifically when a named runtime/vendor meets a reach
// requirement or explicit swap/lock-in pressure.

const RUNTIME_TERMS = [
  'claude', 'claude code', 'chatgpt', 'gpt', 'openai', 'codex', 'cursor',
  'gemini', 'copilot', 'hermes', 'openclaw', 'ollama', 'langchain',
  'langgraph', 'crewai', 'autogen', 'n8n', 'zapier', 'mcp', 'vendor',
  'the vendor', 'platform', 'harness', 'framework', 'wrapper', 'runtime',
  'model', 'provider', 'agent platform'
];

const REACH_TERMS = [
  'browse', 'browse the web', 'web access', 'internet', 'online',
  'search the web', 'web search', 'scrape', 'crawl', 'url', 'website',
  'site', 'webpage', 'page', 'connector', 'connectors', 'integration',
  'api', 'plugin', 'extension', 'filesystem', 'local files', 'read files',
  'read the file', 'database', 'db', 'tool', 'tools', 'tool call',
  'tool calls', 'function call', 'browser', 'reach', 'access'
];

const SWAP_TERMS = [
  'vendor lock', 'lock-in', 'lockin', 'locked in', 'portable',
  'model-agnostic', 'model agnostic', 'provider-agnostic',
  'provider agnostic', 'swap', 'swap the model', 'swap provider',
  'switch model', 'switch provider', 'switch runtime', 'another runtime',
  'another model', 'different model', 'different runtime', 'the same brief',
  'same brief', 'replay', 'cross-runtime', 'cross runtime', 'migrate',
  'replace the model', 'replace the runtime', 'which model', 'which runtime',
  'vendor-independent', 'vendor independent'
];

const STRONG_ACTION_TERMS = [
  'build', 'run', 'use', 'automate', 'deploy', 'ship', 'wire', 'connect',
  'integrate', 'hook up', 'let it', 'have it', 'want it', 'make it', 'worker'
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-word matching (not naive substring) so short terms such as "gpt",
// "db", "api", and "page" cannot false-match inside longer words.
function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    const pattern = new RegExp('\\b' + escapeRegExp(term) + '\\b');
    return pattern.test(text) ? count + 1 : count;
  }, 0);
}

function classifyRuntimeReachPortability(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const runtime = countMatches(text, RUNTIME_TERMS);
  const reach = countMatches(text, REACH_TERMS);
  const swap = countMatches(text, SWAP_TERMS);
  const action = countMatches(text, STRONG_ACTION_TERMS);
  const score = (runtime * 2) + (reach * 2) + (swap * 3) + action;

  // Need a named runtime/vendor surface plus either a reach requirement or
  // explicit swap/lock-in pressure. This keeps ordinary task text out.
  const namesRuntimeWithReach = runtime >= 1 && reach >= 2;
  const explicitSwapPressure = swap >= 1 && (runtime >= 1 || reach >= 2);
  if (!namesRuntimeWithReach && !explicitSwapPressure) {
    return { applies: false, reason: 'no named runtime bound to reach or vendor-swap pressure', score };
  }
  if (action === 0 && swap < 2) {
    return { applies: false, reason: 'descriptive mention, not a run/build request', score };
  }
  if (score < 6) {
    return { applies: false, reason: 'weak runtime-reach signal', score };
  }

  const layer = swap >= 2
    ? 'vendor-independence'
    : namesRuntimeWithReach
      ? 'runtime-reach-gap'
      : 'cross-runtime-replay';

  return {
    applies: true,
    reason: 'a workflow is bound to a named runtime/vendor and its reach; name the reach requirement and the fallback runtime before treating it as done',
    score,
    layer,
    signals: { runtime: runtime, reach: reach, swap: swap, action: action }
  };
}

function runtimeReachPortabilityPromptBlock(message) {
  const classification = classifyRuntimeReachPortability(message);
  if (!classification.applies) return '';

  return '[RUNTIME-REACH PORTABILITY CHECK]\n'
    + 'This request binds work to a named AI runtime/vendor and depends on what that runtime can reach (web, connectors, files, tools, APIs). Reach is per-runtime: the same brief can fail on one model because it cannot touch a source and succeed on another that can. The value is the reusable instruction asset, not the vendor-branded agent layer. Before treating the workflow as done, answer these:\n'
    + '- Named reach requirement: state exactly what the workflow must reach — web/URL/browse/search, a connector, an API, files, a database, or a tool/function call — so the requirement is explicit and testable rather than implied.\n'
    + '- Runtime capability fit: name which runtime(s) actually have that reach, and what happens when the chosen one does not; do not assume one vendor\u2019s agent layer will reach everything now or later.\n'
    + '- Cross-runtime replay: design the brief so the same instructions run on a second capable runtime without rewriting the workflow — instructions, reach, and outcome stay portable; only the runtime binding changes.\n'
    + '- Vendor-independence: do not anchor the workflow in a vendor-built agent layer (per Gartner, up to ~70% of companies are expected to walk away from vendor-built agents by 2028) — keep the instruction asset, context, and checkpoint model-agnostic, and add vendor code only for routing, permissions, UX, or scheduling gaps.\n'
    + '- Fallback proof: run or reason through the brief on a second runtime that has the reach; record the useful output or the exact access gap, so a reach failure is a named gap rather than a silent failure.\n'
    + '- Verdict: portable-across-runtimes (name the reach requirement and the fallback runtime) versus runtime-bound (name what ties it to one vendor and why that is acceptable).\n'
    + '[/RUNTIME-REACH PORTABILITY CHECK]';
}

function appendRuntimeReachPortabilityPrompt(message) {
  const block = runtimeReachPortabilityPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyRuntimeReachPortability,
  runtimeReachPortabilityPromptBlock,
  appendRuntimeReachPortabilityPrompt
};
