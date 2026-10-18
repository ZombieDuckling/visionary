'use strict';

// Deterministic coding-agent loop nudge for requests that hand code work to a
// file-aware coding agent (Claude Code, Cursor, Codex, or an autonomous
// dispatcher). Inspired by Jake Van Clief's coding-agent plan/edit/verify loop
// concept: file-aware agents are useful when they orient from repo files,
// expose a plan, edit within scope, and then prove the result by running the
// real pipeline/tests. Autonomy without that loop creates hidden review debt,
// so Visionary should force orient → plan → scope → edit → verify → report
// before a coding dispatch is trusted.

const CODING_TERMS = [
  'code', 'codebase', 'base code', 'refactor', 'rewrite the module',
  'implement', 'implementation', 'function', 'method', 'class', 'module',
  'endpoint', 'api', 'route', 'schema', 'migration', 'migrate',
  'bug', 'bugfix', 'hotfix', 'patch', 'regression', 'stack trace',
  'unit test', 'unit tests', 'tests', 'test suite', 'lint', 'compile',
  'syntax check', 'dependency', 'dependency upgrade', 'package upgrade',
  'feature', 'build the', 'scaffold', 'typecheck', 'type error',
  'pull request', 'open a pr', 'commit', 'repository', 'repo'
];

const AGENT_TERMS = [
  'coding agent', 'file-aware', 'file aware', 'dispatch to', 'delegate to',
  'claude code', 'cursor', 'codex', 'copilot', 'agent edit', 'let the agent',
  'agent should', 'autonomous', 'auto-accept', 'auto accept', 'hands-off',
  'hands off', 'unattended', 'run the agent'
];

const GUARD_TERMS = [
  'acceptance criteria', 'test plan', 'run the tests', 'run tests',
  'run the test', 'verify', 'verification', 'plan first', 'show me the plan',
  'produce a plan', 'todos', 'minimal change', 'bounded change',
  'smallest change', 'read-only', 'read only'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyCodingAgentLoop(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const coding = countMatches(text, CODING_TERMS);
  const agent = countMatches(text, AGENT_TERMS);
  const guard = countMatches(text, GUARD_TERMS);
  const score = (coding * 2) + (agent * 3);

  if (coding === 0) {
    return { applies: false, reason: 'not a coding task', score };
  }
  if (guard >= 2) {
    return { applies: false, reason: 'operator already supplied plan/verify frame', score };
  }
  if (score < 4) {
    return { applies: false, reason: 'weak coding-agent signal', score };
  }

  const layer = agent >= 1
    ? 'delegated-coding-loop'
    : 'direct-coding-loop';

  return {
    applies: true,
    reason: 'code work needs an orient/plan/scope/edit/verify loop before the agent result is trusted',
    score,
    layer,
    signals: { coding, agent, guard }
  };
}

function codingAgentLoopPromptBlock(message) {
  const classification = classifyCodingAgentLoop(message);
  if (!classification.applies) return '';

  return '[CODING-AGENT LOOP CHECK]\n'
    + 'This is code work. A file-aware coding agent is only useful if it orients from repo files, exposes a plan, edits within scope, and proves the result by running the real pipeline. Do not treat a copied-over / "looks correct" edit as a verified result.\n'
    + '- Orient: read the repo front desk first (README/router, manifest, index, relevant source files) before broad edits or guessing at structure.\n'
    + '- Plan: produce a visible plan/search strategy (target files, order of edits) before touching many files.\n'
    + '- Scope: name the target files, the forbidden/out-of-scope areas, and the acceptance criteria or expected behavior before editing.\n'
    + '- Edit: make bounded changes with observable diffs; keep the change as small as the task allows.\n'
    + '- Verify: run the real checks — syntax check, unit tests, build, or the actual pipeline — and include the exact command output for refactors and fixes, not just a summary.\n'
    + '- Report: summarize changed files, commands run, failures or risks, cost/token mode for long API runs, and the next edit if one remains.\n'
    + '- Persist: update docs/specs/logs so a fresh agent can continue from state, not from this chat.\n'
    + '[/CODING-AGENT LOOP CHECK]';
}

function appendCodingAgentLoopPrompt(message) {
  const block = codingAgentLoopPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyCodingAgentLoop,
  codingAgentLoopPromptBlock,
  appendCodingAgentLoopPrompt
};
