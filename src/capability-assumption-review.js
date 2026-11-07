'use strict';

// Deterministic capability-assumption review nudge for dispatches whose plan
// rests on a claim that the AI/model/tool *cannot* do something — "the model
// can't handle long documents", "AI isn't reliable enough for legal review so
// we keep a human in the loop", "LLMs can't do math, we'll compute it in a
// script", "agents still hallucinate so we double-check everything". Inspired
// by Jake Van Clief's capability short ("If you want to work for me. Try my
// community.", video iWpJr2A2GRc): a "language models are useless" claim was
// defensible at a GPT-3 capability level and simply expired as capability
// ratcheted. The lesson is that a capability claim is a **dated tactic**, not a
// permanent fact: once true, now possibly false, and re-testable against the
// current model/provider. The failure mode this prevents is freezing "the model
// can't do X" into memory, a workflow shape, or a routing decision so the
// operator keeps building around a limitation that a newer model already
// cleared — the same class of error as the historically defensible GPT-3
// critique that aged out.
//
// The durable artifact is the workflow goal and the task the person owns; the
// "can't" claim is the dated tactic layered on top. This nudge makes the
// operator's agents separate the two, name the review trigger (a model release,
// a provider change, a prompt/context change), and re-test cheaply (a small
// probe on the current model, or a shadow task) instead of treating the claim
// as settled.
//
// This is the *dated-capability-claim* layer. Distinct from
// spec-before-the-machine (write the capability spec despite tooling parity),
// workflow-resilience (outage/quota/provider degradation), runtime-reach-
// portability (whether a runtime has the reach the job needs), and
// baseline-ratchet (raising the challenge as the floor rises). It also differs
// from durable-retrospective (recording lessons) — here the point is that one
// recorded lesson is a time-stamped claim that must be re-opened on capability
// change.

// Limitation language: a capability claim, often stated as a hard "can't".
const LIMITATION_TERMS = [
  "can't", 'cannot', "can't do", "can't handle", "can't read", "can't write",
  "can't reason", "can't count", "can't browse", "can't see", "can't search",
  "can't remember", "can't use", "can't think", 'cannot do', 'cannot handle',
  'not able', 'unable', "isn't able", 'is not able', 'not capable', 'incapable',
  'fails at', 'fails to', 'struggles with', 'struggles to', 'not good at',
  "isn't good at", 'is not good at', 'poor at', 'weak at', 'not reliable',
  "isn't reliable", 'is not reliable', 'unreliable', "doesn't understand",
  'does not understand', "doesn't support", 'does not support', 'not yet able',
  'still can\'t', 'too limited', 'not smart enough', 'not accurate',
  'hallucinates', 'makes things up', 'gets it wrong', 'not trustworthy',
  "can't be trusted", 'not possible', 'will never', 'keeps getting', 'always gets'
];

// The AI/tool/model subject the limitation is about — the thing whose capability
// this run is judging.
const AI_SUBJECT_TERMS = [
  'ai', 'the ai', 'an ai', 'llm', 'llms', 'the llm', 'model', 'models',
  'the model', 'language model', 'language models', 'gpt', 'chatgpt', 'claude',
  'gemini', 'copilot', 'agent', 'agents', 'the agent', 'chatbot', 'chatbots',
  'automation', 'the machine', 'the tool', 'ai-generated', 'generative',
  'artificial intelligence'
];

// Decision/workflow framing: the limitation is shaping a choice, a workflow
// shape, or a routing decision — not a passing gripe.
const DECISION_TERMS = [
  'manual', 'manually', 'human', 'keep it', 'keep the', 'so we', 'so i',
  'so the', 'for now', 'for the moment', "we'll", 'we will', 'workflow',
  'process', 'pipeline', 'steps', 'step', 'handle', 'review', 'check',
  'assume', 'assumption', 'assumptions', 'expect', 'plan', 'strategy',
  'decide', 'should we', 'build', 'design', 'set up', 'setup', 'rely',
  'depend', 'route', 'routing', 'assign', 'fallback', 'hand off', 'handoff',
  'whether', 'instead', 'going to', 'want to', 'need to'
];

// The operator already named the claim as dated/re-testable, so the nudge steps
// back rather than nagging.
const REVIEW_FRAME_TERMS = [
  're-test', 'retest', 're-test the assumption', 'dated', 'capability assumption',
  'capability review', 'review trigger', 're-evaluate', 'reevaluate', 'revisit',
  'as models improve', 'when a new model', 'new model', 'model release',
  'provider change', 'stale', 'no longer', 'used to', 'back when',
  'periodically review', 're-test on', 'shadow task'
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-word matching (not naive substring) so short terms such as "ai" and
// "gpt" cannot false-match inside longer words.
function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    const pattern = new RegExp('\\b' + escapeRegExp(term) + '\\b');
    return pattern.test(text) ? count + 1 : count;
  }, 0);
}

function classifyCapabilityAssumptionReview(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const limitation = countMatches(text, LIMITATION_TERMS);
  const subject = countMatches(text, AI_SUBJECT_TERMS);
  const decision = countMatches(text, DECISION_TERMS);
  const reviewFrame = countMatches(text, REVIEW_FRAME_TERMS);
  const score = (limitation * 3) + (subject * 2) + decision - (reviewFrame * 3);

  // Need a capability limitation, the AI/tool it is about, and a workflow
  // decision the claim is shaping.
  if (limitation === 0) {
    return { applies: false, reason: 'no capability-limitation signal', score };
  }
  if (subject === 0) {
    return { applies: false, reason: 'limitation stated without an AI/model/tool subject', score };
  }
  if (decision === 0) {
    return { applies: false, reason: 'capability claim stated without a workflow/decision framing', score };
  }
  if (reviewFrame >= 2) {
    return { applies: false, reason: 'operator already framed the claim as dated and re-testable', score };
  }
  if (score < 8) {
    return { applies: false, reason: 'weak capability-assumption signal', score };
  }

  const layer = limitation >= 2 || subject >= 2
    ? 'capability-assumption-review'
    : 'capability-claim-check';

  return {
    applies: true,
    reason: 'treat the stated AI limitation as a dated tactic with a re-test trigger, not a permanent fact',
    score,
    layer,
    signals: { limitation: limitation, subject: subject, decision: decision, review_frame: reviewFrame }
  };
}

function capabilityAssumptionReviewPromptBlock(message) {
  const classification = classifyCapabilityAssumptionReview(message);
  if (!classification.applies) return '';

  return '[CAPABILITY-ASSUMPTION REVIEW]\n'
    + 'This request leans on a claim that the AI/model/tool cannot do something. Treat that claim as a dated tactic, not a permanent fact.\n'
    + '- Name the assumption: which model/provider/tool, which capability, and — if knowable — the capability level the claim was defensible at (for example a GPT-3-era limitation).\n'
    + '- Assume it may have expired: capability ratchets and a claim that was true when it was formed can be false on the current model. A "the model can\'t do X" statement is a tactic with a date, not a durable principle.\n'
    + '- Separate the durable goal from the dated tactic: the workflow outcome and the decision a person owns are durable; the "can\'t" claim is only the tactic layered on top. Do not redesign the workflow around a limitation that may already be cleared.\n'
    + '- Attach a re-test trigger: a model release, a provider change, or a prompt/context change is the signal to re-open the claim; never freeze it into memory as settled.\n'
    + '- Re-test cheaply: probe the current model directly on the claimed capability (a small representative task), or run a shadow task on the newer model, before deciding to keep working around the limitation.\n'
    + '- State what would have to be true for the assumption to flip, and where the claim is recorded (a dated note), so a future run can find and re-open it.\n'
    + '- Verdict: capability-assumption-held (goal genuinely needs the workaround) vs. stale/re-test (re-run the probe on the current model before keeping the workaround).\n'
    + '[/CAPABILITY-ASSUMPTION REVIEW]';
}

function appendCapabilityAssumptionReviewPrompt(message) {
  const block = capabilityAssumptionReviewPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyCapabilityAssumptionReview,
  capabilityAssumptionReviewPromptBlock,
  appendCapabilityAssumptionReviewPrompt
};
