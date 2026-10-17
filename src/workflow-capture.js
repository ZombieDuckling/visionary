'use strict';

// Deterministic workflow-capture nudge for repeated jobs that are about to be
// automated, scheduled, or delegated to an agent. Inspired by Jake Van Clief's
// two-minute test: most repeated jobs fail in AI because the operator never wrote
// down how the job is actually done, and that missing procedure spec — not the
// model — is the bottleneck. Before building an automation, force the procedure
// into the open (input/do/output/human-check), surface the trip-ups, and reproduce
// it in a fresh session before scripts, agents, or integrations are considered.

const AUTOMATION_TERMS = [
  'automate', 'automation', 'automatic', 'automatically', 'scheduled', 'schedule',
  'cron', 'weekly', 'daily', 'monthly', 'recurring', 'recurrence', 'repeated',
  'repeat every', 'on a schedule', 'unattended', 'hands-off', 'hands off',
  'background job', 'routine', 'batch', 'every week', 'every day', 'every month'
];

const DELEGATION_TERMS = [
  'delegate', 'hand off', 'handoff', 'hand it to', 'let the agent', 'agent should',
  'agent do it', 'run it for me', 'so i don\'t have to', 'stop doing it manually',
  'do it manually', 'agent handle', 'bot', 'agent takes over'
];

const CAPTURE_TERMS = [
  'input', 'output', 'human check', 'human-check', 'human review',
  'two-minute', 'two minute', 'two minutes', 'written down', 'procedure spec',
  'step by step', 'step-by-step', 'trip-up', 'trip up', 'trip-ups'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyWorkflowCapture(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const automation = countMatches(text, AUTOMATION_TERMS);
  const delegation = countMatches(text, DELEGATION_TERMS);
  const capture = countMatches(text, CAPTURE_TERMS);
  const score = (automation * 3) + (delegation * 2);

  if (capture >= 3) {
    return { applies: false, reason: 'operator already supplied capture frame', score };
  }
  if (automation === 0 && delegation === 0) {
    return { applies: false, reason: 'not a repeated/automated/delegated job', score };
  }
  if (score < 4) {
    return { applies: false, reason: 'weak automation/delegation signal', score };
  }

  const layer = delegation >= 1
    ? 'capture-before-delegation'
    : 'capture-before-automation';

  return {
    applies: true,
    reason: 'repeated jobs should be written down before they are automated or delegated',
    score,
    layer,
    signals: { automation, delegation, capture }
  };
}

function workflowCapturePromptBlock(message) {
  const classification = classifyWorkflowCapture(message);
  if (!classification.applies) return '';

  return '[WORKFLOW-CAPTURE CHECK]\n'
    + 'This looks like a repeated job being automated, scheduled, or delegated. Before building the automation, capture how the job is actually done — the missing written procedure is usually the real bottleneck, not the model.\n'
    + '- Two-minute test: write how this job is done on one page in two minutes, then have a fresh reader (a coworker or a fresh agent/chat) follow it. Mark every point where they get stuck; those trip-ups are the deliverable, not noise.\n'
    + '- Input: where the work comes from — sources, triggers, data, access, and permissions.\n'
    + '- Do: the steps and the judgment calls, including when to deviate.\n'
    + '- Output: what comes out, in what format, and who receives it.\n'
    + '- Human check: where a person verifies or corrects the work before it moves on.\n'
    + '- Interview instead of cold-writing: if the operator is available, ask one question at a time until these headings are filled, then write the procedure.\n'
    + '- Fresh-chat reproduction: drop the captured page into a fresh session, record every point it trips, and turn those into boundary/spec/eval additions.\n'
    + '- Automate only after: classify each step (human, script, one-shot LLM, agent, integration) with docs/AUTOMATION-TIMING-RUBRIC.md before building scripts, agents, or schedules.\n'
    + '[/WORKFLOW-CAPTURE CHECK]';
}

function appendWorkflowCapturePrompt(message) {
  const block = workflowCapturePromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyWorkflowCapture,
  workflowCapturePromptBlock,
  appendWorkflowCapturePrompt
};
