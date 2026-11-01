'use strict';

// Deterministic efficiency-vs-amplification nudge for requests whose stated win
// is efficiency or the removal of the human — "we can be more efficient",
// "reduce headcount", "fewer people", "do more with less", "cut the manual
// step", "save time". Inspired by Jake Van Clief's bicycle-for-the-mind lesson
// (video AiMOZIEcza0, concept augment-over-automate): Jobs deliberately chose
// the word *bicycle* — a tool that "made a person do more, didn't replace the
// person" — against the era's default of buying computers to replace people
// "so we can be more efficient". Efficiency-as-replacement and
// person-amplification are not the same axis: the bicycle multiplies a rider
// who still steers, and "a tool given to us so we could decide what to do with
// that efficiency." Visionary should force the amplified human capacity and the
// rider's retained decision to be named before an efficiency/replacement claim
// is treated as the win.
//
// This is the *value-framing* layer. Distinct from augment-over-automate (which
// fires on the automation posture — automate/hands-off/autonomous riderless
// claims) and augmentation-means (which fires on adding tooling without
// methodology/language/training). This nudge fires on the framing of the win
// itself, including offers, pitches, product copy, and success metrics, where
// no automation verb need be present.

const REPLACEMENT_TERMS = [
  'replace the human', 'replace humans', 'replace people', 'replace the person',
  'replace a person', 'replace me', 'replace the worker', 'replace the operator',
  'replaces the human', 'replace our team', 'replace the staff',
  'reduce headcount', 'cut headcount', 'lower headcount', 'reduce the headcount',
  'headcount reduction',
  'fewer people', 'fewer staff', 'fewer employees', 'fewer workers',
  'fewer humans', 'need fewer people', 'no longer need people',
  'reduce the team', 'cut the team', 'shrink the team', 'reduce staff',
  'cut staff', 'reduce the workforce', 'cut the workforce',
  'reduce the payroll', 'save on payroll',
  'remove the manual step', 'remove manual steps', 'remove the manual work',
  'remove the manual', 'eliminate the manual step', 'eliminate manual steps',
  'replace the manual step', 'replace manual steps', 'replace the manual work',
  'replace the manual', 'replace the step', 'replace that step', 'replace the task',
  'eliminate manual work', 'remove the human', 'remove the person',
  'remove humans', 'take the human out', 'take the person out', 'take humans out',
  'no longer need a person', 'no longer need someone', 'no longer need a human',
  'without a person', 'without people', 'no humans needed',
  'do more with less', 'more with less', 'headcount', 'downsize',
  'do the job without a person', 'do the work that used to take'
];

const EFFICIENCY_TERMS = [
  'efficiency', 'efficient', 'more efficient', 'efficiently',
  'efficiency gain', 'efficiency gains', 'productivity', 'productive',
  'productivity gain', 'productivity gains', 'throughput',
  'streamline', 'streamlining', 'optimize the process', 'optimise the process',
  'process optimization', 'process optimisation',
  'cost saving', 'cost savings', 'save costs', 'reduce cost', 'reduce costs',
  'reduce the cost', 'cut cost', 'cut costs', 'lower cost', 'lower costs',
  'save time', 'time savings', 'time saving', 'faster', 'speed up',
  'speed things up', 'get more done', 'more output', 'scale output',
  'scale the output', 'work faster', 'turnaround time', 'cost per',
  'return on investment', 'roi'
];

const AMPLIFICATION_TERMS = [
  'amplify', 'amplification', 'amplified', 'amplified intelligence',
  'multiply the human', 'multiply the person', 'amplify the human',
  'amplify the person', 'capability multiplier', 'human capacity',
  'human in the loop', 'human-in-the-loop', 'human decides', 'human still decides',
  'human steers', 'operator steers', 'the human still', 'person still',
  'rider', 'bicycle', 'bicycle for the mind', 'person does more',
  'human does more', 'makes the person do more', 'augment', 'augmentation',
  'give the capacity', 'who is amplified', 'human keeps', 'human retains',
  'human review', 'review gate', 'sign-off', 'checkpoint', 'human override'
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-word matching (not naive substring) so short terms such as "roi" and
// "faster" cannot false-match inside longer words.
function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    const pattern = new RegExp('\\b' + escapeRegExp(term) + '\\b');
    return pattern.test(text) ? count + 1 : count;
  }, 0);
}

function classifyEfficiencyVsAmplification(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const replacement = countMatches(text, REPLACEMENT_TERMS);
  const efficiency = countMatches(text, EFFICIENCY_TERMS);
  const amplification = countMatches(text, AMPLIFICATION_TERMS);

  if (replacement === 0 && efficiency === 0) {
    return { applies: false, reason: 'not an efficiency or replacement claim', score: 0 };
  }
  if (amplification >= 2) {
    return { applies: false, reason: 'person-amplification frame already present', score: replacement + efficiency };
  }
  if (replacement === 0 && efficiency < 2) {
    return { applies: false, reason: 'weak efficiency signal', score: efficiency };
  }

  const layer = replacement >= 1
    ? 'replacement-framing'
    : 'efficiency-only-framing';

  return {
    applies: true,
    reason: 'the win is framed as efficiency or removal of the human; name the amplified capacity and the rider\'s retained decision, or label it pure automation',
    score: replacement + efficiency,
    layer,
    signals: { replacement: replacement, efficiency: efficiency, amplification: amplification }
  };
}

function efficiencyVsAmplificationPromptBlock(message) {
  const classification = classifyEfficiencyVsAmplification(message);
  if (!classification.applies) return '';

  return '[EFFICIENCY-VS-AMPLIFICATION CHECK]\n'
    + 'This request frames the win as efficiency or as removing the human step. Efficiency-as-replacement and person-amplification are not the same axis — the win is not fewer people. Before treating the result as done, answer these:\n'
    + '- Value axis: state which axis the win is on — efficiency-as-replacement (the human step or role goes away) or person-amplification (the person does more and still steers). Name it; do not flatten both into "better" or "more efficient".\n'
    + '- Amplified capacity: name the human role and the capacity multiplied (search, drafting, synthesis, review speed, reach) — not just the step, task, or headcount removed.\n'
    + '- The rider\'s decision: state what the human still gets to decide with the new capacity (direction, goals, exception handling, final judgment). Give capacity, then do not pre-decide the human\'s goals for them.\n'
    + '- Structure supplied: name the context, memory, files/artifacts, examples, and review gates that turn raw automation into amplification — not a bare prompt.\n'
    + '- Measurement: define success by the amplified human outcome (what the person can now do) — not only by tokens, agents, steps, time saved, or headcount reduced.\n'
    + '- No riderless machine: a tool that does more without a person is pure automation, not amplification — label those steps automation and justify them as automation.\n'
    + '- Verdict: person-amplification (name the rider and their retained decision) versus efficiency-as-replacement (name only what is genuinely safe to replace).\n'
    + '[/EFFICIENCY-VS-AMPLIFICATION CHECK]';
}

function appendEfficiencyVsAmplificationPrompt(message) {
  const block = efficiencyVsAmplificationPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyEfficiencyVsAmplification,
  efficiencyVsAmplificationPromptBlock,
  appendEfficiencyVsAmplificationPrompt
};
