'use strict';

// Deterministic baseline-ratchet nudge for improvement/modernization work.
// Inspired by Jake Van Clief's "we forget what we already use is magic" lesson:
// once an AI capability becomes normal infrastructure, workflows should reset
// the baseline instead of celebrating yesterday's novelty.

const CHANGE_TERMS = [
  'improve', 'upgrade', 'modernize', 'rebaseline', 'baseline', 'ratchet', 'raise the bar',
  'make better', 'optimize', 'refresh', 'revise', 'iterate', 'replace', 'automate',
  'streamline', 'scale', 'productionize', 'level up'
];

const WORKFLOW_TERMS = [
  'workflow', 'process', 'system', 'dashboard', 'agent', 'agents', 'automation',
  'tool', 'product', 'feature', 'task', 'runbook', 'sop', 'ops', 'review',
  'onboarding', 'dispatch', 'pipeline', 'workspace', 'workbench'
];

const BASELINE_TERMS = [
  'old way', 'manual', 'current', 'existing', 'before', 'after', 'today', 'last month',
  'normal', 'table stakes', 'commoditized', 'expected', 'benchmark', 'metric',
  'acceptance criteria', 'verification', 'proof', 'measure', 'compare'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyBaselineRatchet(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const change = countMatches(text, CHANGE_TERMS);
  const workflow = countMatches(text, WORKFLOW_TERMS);
  const baseline = countMatches(text, BASELINE_TERMS);
  const score = (change * 3) + (workflow * 2) + baseline;

  if (change === 0 || workflow === 0) {
    return { applies: false, reason: 'not workflow-improvement shaped', score };
  }
  if (baseline >= 3) {
    return { applies: false, reason: 'operator already supplied baseline frame', score };
  }
  if (score < 6) {
    return { applies: false, reason: 'weak baseline-ratchet signal', score };
  }

  const layer = change >= 2 || baseline >= 1
    ? 'baseline-ratchet'
    : 'lightweight-baseline-check';

  return {
    applies: true,
    reason: 'workflow improvement should reset the operating baseline before building',
    score,
    layer,
    signals: { change, workflow, baseline }
  };
}

function baselineRatchetPromptBlock(message) {
  const classification = classifyBaselineRatchet(message);
  if (!classification.applies) return '';

  return '[BASELINE-RATCHET CHECK]\n'
    + 'This looks like workflow/product/process improvement work. Before executing, reset the operating baseline so the output targets current capability rather than yesterday\'s novelty.\n'
    + '- Old/manual baseline: what did a human, script, or prior agent workflow have to do before this became easy?\n'
    + '- Current AI baseline: what is now cheap, normal, or table-stakes enough that it should become infrastructure?\n'
    + '- Raised expectation: what higher-value human+AI outcome should replace the old definition of done?\n'
    + '- Verification: name the metric, smoke check, artifact, review output, or acceptance criterion that proves the bar actually moved.\n'
    + '- Scope guard: do not add platform surface just for novelty; improve the smallest workflow layer that creates durable leverage.\n'
    + 'Keep this concise and then deliver the requested work.\n'
    + '[/BASELINE-RATCHET CHECK]';
}

function appendBaselineRatchetPrompt(message) {
  const block = baselineRatchetPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyBaselineRatchet,
  baselineRatchetPromptBlock,
  appendBaselineRatchetPrompt
};