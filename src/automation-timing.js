'use strict';

// Deterministic automation-timing nudge for requests that propose making a step
// automatic — adding an agent, a schedule, a cron, an integration, a webhook, or
// a "workflow". Inspired by Jake Van Clief's "The Real Skill in AI: Knowing What
// Not to Automate" (video ZMDXs59Ntjc): the valuable skill is not "automate
// everything" — it is deciding where human thinking belongs, when to offload it,
// and when a cheap manual bridge beats a brittle integration. A workflow should
// graduate up a ladder (manual note -> copy/paste assist -> deterministic helper
// -> one-shot agent -> scheduled automation -> productized integration) and only
// escalate a level once trigger clarity, input boundaries, failure handling,
// review surface, reversibility, and cost/risk fit are all true.
//
// Visionary already carries this rubric as prose (docs/AUTOMATION-TIMING-RUBRIC.md)
// and its surfaces (kanban dispatch, scheduler/crons, scripts, review verdicts),
// but nothing applied it at dispatch time. This nudge makes the operator's agents
// actually place a proposed automation on the ladder and name the retained human
// checkpoint before wiring it up.
//
// This is the *escalation-timing* layer: it fires on a proposal to automate a
// step and asks whether and how far to automate it. Distinct from
// augment-over-automate (which fires on the riderless "hands-off/autonomous"
// posture once automation is chosen), ai-workflow-ladder (which fires on
// AI-learning / workflow-promotion framing), workflow-capture (the written
// procedure for a repeated job), and workflow-resilience (provider outage/quota
// handling), and execution-evidence-gate (trusting a "running/successful" status).

const AUTOMATION_TERMS = [
  'automate', 'automation', 'automated', 'autonomous', 'autonomy',
  'agentic', 'agent', 'agents', 'delegate', 'productize', 'productise',
  'integrate', 'integration', 'connect', 'connector', 'hook up', 'webhook',
  'pipeline', 'schedule', 'scheduled', 'cron', 'cronjob', 'cron job',
  'recurring', 'recurring job', 'run on a schedule', 'set-and-forget',
  'set and forget', 'hands-off', 'hands off', 'run itself', 'runs itself',
  'auto-run', 'autopilot', 'auto-pilot'
];

const STEP_TERMS = [
  'step', 'steps', 'task', 'tasks', 'manual', 'manually', 'every time',
  'each time', 'repeatedly', 'repeated', 'per client', 'per lead', 'per record',
  'for each', 'batch', 'bulk', 'daily', 'weekly', 'monthly', 'every day',
  'every week', 'every morning', 'every night', 'copy/paste', 'copy paste',
  'review', 'approve', 'approval', 'sign-off', 'signoff', 'validate',
  'validation', 'format', 'convert', 'parse', 'sort', 'classify', 'extract',
  'report', 'reporting', 'workflow', 'process', 'procedure'
];

// Signals the operator already supplied an escalation frame/ladder, so the nudge
// steps back rather than nagging.
const LADDER_FRAME_TERMS = [
  'rung', 'ladder', 'escalation level', 'escalation ladder', 'level 0',
  'level 1', 'level 2', 'level 3', 'level 4', 'level 5', 'manual note',
  'copy/paste assist', 'copy paste assist', 'deterministic helper',
  'one-shot', 'scheduled automation', 'productized', 'human checkpoint',
  'human in the loop', 'human-in-the-loop', 'cheapest sufficient',
  'demotion', 'promote one rung'
];

const STRONG_ACTION_TERMS = [
  'build', 'run', 'use', 'add', 'set up', 'setup', 'wire', 'connect', 'deploy',
  'ship', 'create', 'want', 'need', 'let it', 'have it', 'make it', 'start',
  'introduce', 'stand up', 'automate', 'automating', 'integrate'
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-word matching (not naive substring) so short terms such as "cron",
// "step", and "task" cannot false-match inside longer words.
function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    const pattern = new RegExp('\\b' + escapeRegExp(term) + '\\b');
    return pattern.test(text) ? count + 1 : count;
  }, 0);
}

function classifyAutomationTiming(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const automation = countMatches(text, AUTOMATION_TERMS);
  const step = countMatches(text, STEP_TERMS);
  const ladderFrame = countMatches(text, LADDER_FRAME_TERMS);
  const action = countMatches(text, STRONG_ACTION_TERMS);
  const score = (automation * 3) + (step * 2) + action - (ladderFrame * 3);

  // Need a proposal to automate something concrete: an automation surface plus
  // the step it would take over. This keeps ordinary task text out.
  if (automation === 0) {
    return { applies: false, reason: 'no automation/agent/schedule intent', score };
  }
  if (step === 0) {
    return { applies: false, reason: 'automation mentioned without a concrete step', score };
  }
  if (automation >= 1 && step >= 2 && ladderFrame >= 2) {
    return { applies: false, reason: 'operator already supplied the escalation frame', score };
  }
  if (action === 0 && automation < 2) {
    return { applies: false, reason: 'descriptive mention, not a run/build request', score };
  }
  if (score < 8) {
    return { applies: false, reason: 'weak automation-timing signal', score };
  }

  const layer = ladderFrame === 0 && automation >= 2 && step >= 2
    ? 'escalation-check'
    : 'target-level-check';

  return {
    applies: true,
    reason: 'a step is being made automatic — place it on the escalation ladder and name the retained human checkpoint before wiring it up',
    score,
    layer,
    signals: { automation: automation, step: step, ladder_frame: ladderFrame, action: action }
  };
}

function automationTimingPromptBlock(message) {
  const classification = classifyAutomationTiming(message);
  if (!classification.applies) return '';

  return '[AUTOMATION-TIMING CHECK]\n'
    + 'This request proposes making a step automatic (an agent, a schedule, a cron, an integration, a webhook, or a "workflow"). Before wiring it up, place the step on the escalation ladder and name where human judgment stays. The valuable skill is deciding what NOT to automate, not automating everything.\n'
    + '- Target level: price the current step on Visionary\u2019s ladder \u2014 manual note, copy/paste assist, deterministic helper script, one-shot agent dispatch, scheduled automation, or productized integration \u2014 and say which level this change actually is, not which sounds impressive.\n'
    + '- Cheapest sufficient level: recommend the lowest level that removes the real friction; prefer a deterministic script before an agent and a reviewable task before an autonomous cron. Do not jump to an agentic loop until simpler methods are shown to fail.\n'
    + '- Retained human checkpoint: name the step that must stay interruptible or reviewable because judgment, accountability, domain risk, or missing context lives there \u2014 and where the operator approves or steers (Runs & Artifacts, review verdict, task card).\n'
    + '- Promotion evidence: state the trigger, input/secret boundaries, failure handling, review surface (logs/artifacts/status/cost), and reversibility before escalating a level; name the fresh-session or pressure-test that proves the workflow survives beyond this chat.\n'
    + '- Demotion trigger: name what would move it back down \u2014 unclear artifacts, repeated review failures, surprise spend, ambiguous ownership between agents, or actions the operator must undo by hand.\n'
    + '- Verdict: state the target escalation level and the retained human checkpoint (or "no human checkpoint needed" with the reason).\n'
    + '[/AUTOMATION-TIMING CHECK]';
}

function appendAutomationTimingPrompt(message) {
  const block = automationTimingPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyAutomationTiming,
  automationTimingPromptBlock,
  appendAutomationTimingPrompt
};
