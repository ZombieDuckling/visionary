'use strict';

// Deterministic continuity nudge for dispatches that ask an agent to resume,
// unblock, hand off, or reconcile ongoing work. Inspired by Jake Van Clief's
// position-addressed memory/workbench lesson: long-running work should start
// from named state, source files, artifacts, blockers, and verification history
// rather than a blank-chat interpretation of "continue".

const CONTINUITY_TERMS = [
  'continue', 'resume', 'pick up', 'carry on', 'carry forward', 'where we left',
  'left off', 'handoff', 'hand off', 'next pass', 'next run', 'follow up',
  'follow-up', 'unblock', 'stuck', 'blocked', 'restore', 'reopen', 'restart'
];

const STATE_TERMS = [
  'status', 'state', 'progress', 'history', 'previous', 'latest', 'last',
  'existing', 'current', 'backlog', 'todo', 'done', 'review', 'artifact',
  'artifacts', 'workdir', 'workspace', 'log', 'logs', 'commit', 'diff'
];

const DELIVERY_TERMS = [
  'ship', 'finish', 'verify', 'test', 'smoke', 'report', 'summary', 'runbook',
  'decision', 'next target', 'acceptance', 'blocker', 'blockers'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyContinuityWorkbench(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const continuityMatches = countMatches(text, CONTINUITY_TERMS);
  const stateMatches = countMatches(text, STATE_TERMS);
  const deliveryMatches = countMatches(text, DELIVERY_TERMS);
  const score = (continuityMatches * 3) + (stateMatches * 2) + deliveryMatches;

  if (continuityMatches === 0) {
    return { applies: false, reason: 'no continuity signal', score };
  }
  if (score < 5) {
    return { applies: false, reason: 'weak continuity signal', score };
  }

  const layer = stateMatches >= 2 || text.indexOf('handoff') !== -1 || text.indexOf('where we left') !== -1 || text.indexOf('left off') !== -1
    ? 'state-reconciliation'
    : deliveryMatches >= 2
      ? 'finish-and-verify'
      : 'lightweight-continuation';

  return {
    applies: true,
    reason: 'ongoing work should reconcile prior state before execution',
    score,
    layer,
    signals: {
      continuity: continuityMatches,
      state: stateMatches,
      delivery: deliveryMatches
    }
  };
}

function continuityWorkbenchPromptBlock(message) {
  const classification = classifyContinuityWorkbench(message);
  if (!classification.applies) return '';

  return '[CONTINUITY-WORKBENCH CHECK]\n'
    + 'This looks like ongoing work. Before acting, recover the smallest useful state instead of guessing from the current message alone. Keep it proportional.\n'
    + '- Last known state: identify the relevant task/project status, prior run, branch/commit, artifact/workdir, or handoff note you used.\n'
    + '- Source pointers: name the files, logs, issues, briefs, or dashboard records that anchor your continuation.\n'
    + '- Delta to execute: state what changed since the last pass, what remains, and the next bounded action.\n'
    + '- Blockers and assumptions: separate verified blockers from assumptions; do not silently overwrite unresolved human/user changes.\n'
    + '- Verification trail: run or name the checks that prove the continuation landed, and report exact remaining gaps.\n'
    + 'Do not turn this into a planning ceremony; use it to avoid stale-context mistakes while still finishing the task.\n'
    + '[/CONTINUITY-WORKBENCH CHECK]';
}

function appendContinuityWorkbenchPrompt(message) {
  const block = continuityWorkbenchPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyContinuityWorkbench,
  continuityWorkbenchPromptBlock,
  appendContinuityWorkbenchPrompt
};
