'use strict';

// Deterministic portable-instruction nudge for requests that start from agent
// wrappers, harnesses, vendor frameworks, or custom orchestration before the
// reusable workflow asset exists. Inspired by Jake Van Clief's lesson: the moat
// is the portable outcome/instructions/files/tools/checkpoint package, not the
// wrapper that happens to run it first.

const WORKFLOW_TERMS = [
  'workflow', 'workflows', 'process', 'procedure', 'sop', 'playbook', 'checklist',
  'prompt', 'prompts', 'instruction', 'instructions', 'skill', 'template',
  'runbook', 'agent', 'agents', 'assistant', 'bot', 'automation', 'automate',
  'orchestrate'
];

const WRAPPER_TERMS = [
  'wrapper', 'wrappers', 'framework', 'platform', 'harness', 'runtime', 'vendor',
  'openai', 'chatgpt', 'claude', 'cursor', 'codex', 'gemini', 'hermes', 'openclaw',
  'langchain', 'langgraph', 'crew', 'crewai', 'autogen', 'n8n', 'zapier', 'mcp'
];

const PORTABLE_TERMS = [
  'portable', 'model-agnostic', 'model agnostic', 'runnable', 'runbook', 'folder',
  'workbench', 'files', 'tools', 'tool', 'context', 'review', 'checkpoint',
  'handoff', 'fallback', 'provider', 'providers', 'assumptions', 'contract'
];

const STRONG_ACTION_TERMS = [
  'build', 'create', 'design', 'make', 'add', 'convert', 'wrap', 'package',
  'ship', 'deploy', 'implement', 'route', 'port', 'migrate', 'standardize'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyPortableInstructionAsset(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const workflow = countMatches(text, WORKFLOW_TERMS);
  const wrapper = countMatches(text, WRAPPER_TERMS);
  const portable = countMatches(text, PORTABLE_TERMS);
  const action = countMatches(text, STRONG_ACTION_TERMS);
  const score = (workflow * 2) + (wrapper * 3) + (portable * 2) + action;

  if (workflow === 0) {
    return { applies: false, reason: 'no workflow/instruction asset signal', score };
  }
  if (wrapper === 0 && portable < 2) {
    return { applies: false, reason: 'no wrapper or portability pressure', score };
  }
  if (action === 0 && score < 10) {
    return { applies: false, reason: 'descriptive mention, not an implementation request', score };
  }
  if (score < 9) {
    return { applies: false, reason: 'weak portable-instruction signal', score };
  }

  const layer = wrapper >= 3
    ? 'wrapper-to-portable-workflow'
    : portable >= 3
      ? 'portable-runtime-contract'
      : 'instruction-asset-capture';

  return {
    applies: true,
    reason: 'workflow should be captured as a portable instruction asset before wrapper buildout',
    score,
    layer,
    signals: { workflow, wrapper, portable, action }
  };
}

function portableInstructionAssetPromptBlock(message) {
  const classification = classifyPortableInstructionAsset(message);
  if (!classification.applies) return '';

  return '[PORTABLE-INSTRUCTION ASSET CHECK]\n'
    + 'This looks like a workflow/agent request that may be starting from a wrapper, framework, harness, or vendor surface. Capture the valuable workflow as a portable instruction asset before building wrapper-specific behavior.\n'
    + '- Outcome contract: name the job-to-be-done, expected output, done criteria, and what should stop for human review.\n'
    + '- Model-agnostic instructions: write the smallest reusable steps/checklist that Claude, ChatGPT, Codex, Hermes, OpenClaw, or a human could follow.\n'
    + '- Reachable context/tools: list required files, folders, APIs, commands, connectors, permissions, and which are read-only or writable.\n'
    + '- Runtime assumptions: state provider/model/tool assumptions, secret boundaries, cost/rate limits, and safe fallback if the first harness fails.\n'
    + '- Review checkpoint: define the evidence/artifacts a reviewer should inspect before trusting or productizing the output.\n'
    + '- Portability proof: if feasible, run or reason through the same asset on a second capable runtime/tool; record useful output or the exact access gap.\n'
    + 'Only add custom agent/wrapper code for routing, permissions, UX, scheduling, or integration gaps the portable asset cannot cover.\n'
    + '[/PORTABLE-INSTRUCTION ASSET CHECK]';
}

function appendPortableInstructionAssetPrompt(message) {
  const block = portableInstructionAssetPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyPortableInstructionAsset,
  portableInstructionAssetPromptBlock,
  appendPortableInstructionAssetPrompt
};
