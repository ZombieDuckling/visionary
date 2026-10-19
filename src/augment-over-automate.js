'use strict';

// Deterministic augmentation-over-automation nudge for requests that remove the
// human from a workflow — "autonomous", "hands-off", "unattended",
// "set-and-forget", "no human", "fully automated". Inspired by Jake Van Clief's
// Engelbart lesson (video oDpNYDAaIiM, concept augment-over-automate):
// "the worst software only automates; the best software automates to augment."
// Automation without a named augmented human, the structure supplied, the
// steering points, and verification is the weak version of the product. Visionary
// should force the augmented human, the structure, and the human control points
// to be named before "riderless execution" autonomy is trusted.
//
// This is distinct from the workflow-capture nudge (which fires on repeated jobs
// being automated and covers the written procedure) and the automation-timing
// rubric (which decides *whether* to escalate a step). This nudge fires on the
// augmentation posture itself: the removal of the human whose judgment and
// accountability the workflow still needs.

const AUTOMATION_TERMS = [
  'automate', 'automation', 'automated', 'autonomous', 'autonomy',
  'agentic', 'delegate', 'productize', 'productise',
  'hands-off', 'hands off', 'unattended', 'self-running', 'autopilot',
  'auto-pilot', 'scale the workflow', 'run it on a schedule'
];

const RIDERLESS_TERMS = [
  'autonomous', 'autonomy', 'hands-off', 'hands off', 'unattended',
  'set-and-forget', 'set and forget', 'fire and forget', 'fully automate',
  'fully automated', 'full automation', 'no human', 'without a human',
  'replace the human', 'replace humans', 'replace me', 'removes the human',
  'the agent does everything', 'agent does everything', 'agent handles everything',
  'runs itself', 'run itself', 'straight through', 'end-to-end automated',
  'zero-touch', 'zero touch', 'no human in the loop', 'no one needs to'
];

const AUGMENT_TERMS = [
  'human in the loop', 'human-in-the-loop', 'augment', 'augmentation',
  'human review', 'human reviews', 'human check', 'human sign-off',
  'operator steer', 'operator steering', 'steering', 'steer', 'override',
  'human override', 'rollback', 'escalate', 'escalation', 'supervised',
  'supervision', 'checkpoint', 'review gate', 'review step', 'approval',
  'approve', 'final judgment', 'human decides', 'human stays',
  'keep the human', 'who is augmented', 'sign-off'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyAugmentOverAutomate(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const automation = countMatches(text, AUTOMATION_TERMS);
  const riderless = countMatches(text, RIDERLESS_TERMS);
  const augment = countMatches(text, AUGMENT_TERMS);

  if (automation === 0 && riderless === 0) {
    return { applies: false, reason: 'not an automation request', score: 0 };
  }
  if (augment >= 2) {
    return { applies: false, reason: 'augmentation frame already present', score: automation + riderless };
  }
  if (riderless === 0 && automation < 2) {
    return { applies: false, reason: 'weak automation signal', score: automation };
  }

  const layer = riderless >= 1
    ? 'riderless-automation-claim'
    : 'automation-request';

  return {
    applies: true,
    reason: 'automation removes the human; name who is augmented, the structure supplied, and the steering/verification points before trusting the result',
    score: automation + riderless,
    layer,
    signals: { automation, riderless, augment }
  };
}

function augmentOverAutomatePromptBlock(message) {
  const classification = classifyAugmentOverAutomate(message);
  if (!classification.applies) return '';

  return '[AUGMENT-OVER-AUTOMATE CHECK]\n'
    + 'This request automates or hands a workflow to an agent. Automation removes the human; augmentation multiplies the human while they stay in control. Structure — context, memory, files, branching, examples, review gates — is the product; automation alone is the weak version. Before treating the autonomy as done, answer these:\n'
    + '- Who is augmented: name the human role and the capacity being multiplied (search, drafting, synthesis, review speed) — not just the task being removed.\n'
    + '- What structure is supplied: the context, memory, files/tools, examples, and review gates the agent works from — not a hidden chat or bare prompt.\n'
    + '- Where the human steers: intake, direction, exception handling, approval, and final judgment — the points where a person can still decide.\n'
    + '- What is verified: evidence the augmented human can still see, check, and correct the output; name the rollback or escalation path.\n'
    + '- What is truly safe to fully automate: only high-volume, low-ambiguity, well-tested steps with rollback — the rest stays a human-in-the-loop step.\n'
    + '[/AUGMENT-OVER-AUTOMATE CHECK]';
}

function appendAugmentOverAutomatePrompt(message) {
  const block = augmentOverAutomatePromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyAugmentOverAutomate,
  augmentOverAutomatePromptBlock,
  appendAugmentOverAutomatePrompt
};
