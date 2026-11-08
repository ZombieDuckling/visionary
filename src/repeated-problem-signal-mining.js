'use strict';

// Deterministic repeated-problem signal-mining nudge for requests that decide
// *what to build next* — roadmap, backlog, prioritization, "which feature",
// "what should we ship". Inspired by Jake Van Clief's Adoba pitch
// (video ENQgYWikm2Q): the community surfaced the same problems "over and over
// and over again", and those repeated complaints became the product thesis
// rather than an invented roadmap. The durable principle is that a repeated,
// unsolicited problem report is a validated spec source — the most-repeated
// problem *is* the requirement — and the same community that produced the
// problems doubles as the funnel and the talent pipeline.
//
// The failure mode this prevents is the classic builder inversion: invent a
// feature, then hunt for demand. Visionary's product direction is to become
// useful in real workflows; that only happens if its roadmap is sourced from
// repeated real user/workbench complaints instead of internal idea lists. This
// nudge makes the operator's agents rank the repeated problems, name the
// proof/case artifacts, map the funnel and talent paths, and separate a
// repeated-problem-sourced requirement from an invented feature.
//
// This is the *problem-index / demand-source* layer. Distinct from
// opportunity-routing (route a market/client workflow to paid pain that already
// moves money), question-discovery (extract the right question from an
// underdefined task), cross-domain-adjacency (borrow an idea from an adjacent
// field), and challenge-design (raise the challenge bar). It also differs from
// durable-retrospective (recording a lesson) — here the point is to mine a
// *repeated* signal and treat it as the requirement before building.

// Roadmap / what-to-build-next framing: the request is choosing what to build,
// ship, or prioritize — not executing a decided task.
const ROADMAP_TERMS = [
  'roadmap', 'backlog', 'prioritize', 'prioritise', 'prioritization',
  'prioritisation', 'priority', 'what should we build', 'what should we ship',
  'what to build', 'build next', 'next feature', 'which feature', 'feature',
  'features', 'next thing', 'what next', 'product direction', 'product roadmap',
  'iteration', 'plan the next', 'decide what to build', 'quarter', 'milestone',
  'scope the next', 'product decision', 'feature request'
];

// Problem-source framing: where the reported problems come from — real users or
// a community, not an internal idea list.
const PROBLEM_SOURCE_TERMS = [
  'user', 'users', 'community', 'communities', 'members', 'customer',
  'customers', 'feedback', 'complaint', 'complaints', 'issue', 'issues',
  'github issues', 'bug report', 'bug reports', 'reported', 'reports',
  'requests', 'asked', 'kept asking', 'problem', 'problems', 'pain points',
  'friction', 'support', 'intake', 'inbound'
];

// Repetition framing: the signal is *repeated*, which is what makes it a spec
// rather than a one-off gripe.
const REPETITION_TERMS = [
  'repeated', 'repeatedly', 'again and again', 'over and over',
  'same problem', 'keeps', 'keep', 'recurring', 'recur', 'common',
  'most requested', 'most common', 'most repeated', 'pattern', 'recurrence'
];

// The operator already framed the roadmap as a repeated-problem signal, so the
// nudge steps back rather than nagging.
const FRAME_TERMS = [
  'repeated problem', 'repeated-problem', 'problem signal', 'problem index',
  'reported repeatedly', 'ranked list', 'demand signal', 'spec source',
  'community first', 'users define the spec', 'most-repeated problem',
  'most repeated problem', 'complaint stream', 'problem stream'
];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-word matching (not naive substring) so short terms such as "keep",
// "user", and "issue" cannot false-match inside longer words.
function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    const pattern = new RegExp('\\b' + escapeRegExp(term) + '\\b');
    return pattern.test(text) ? count + 1 : count;
  }, 0);
}

function classifyRepeatedProblemSignalMining(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const roadmap = countMatches(text, ROADMAP_TERMS);
  const source = countMatches(text, PROBLEM_SOURCE_TERMS);
  const repetition = countMatches(text, REPETITION_TERMS);
  const frame = countMatches(text, FRAME_TERMS);
  const score = (roadmap * 3) + (source * 2) + (repetition * 2) - (frame * 3);

  // Need a what-to-build-next decision, a real user/community problem source,
  // and a repeated (not one-off) signal.
  if (frame >= 2) {
    return { applies: false, reason: 'operator already framed the roadmap as a repeated-problem signal', score };
  }
  if (roadmap === 0) {
    return { applies: false, reason: 'no roadmap/what-to-build-next signal', score };
  }
  if (source === 0) {
    return { applies: false, reason: 'build decision stated without a user/community problem source', score };
  }
  if (repetition === 0) {
    return { applies: false, reason: 'problem source named without a repeated-signal framing', score };
  }
  if (score < 8) {
    return { applies: false, reason: 'weak repeated-problem signal', score };
  }

  const layer = repetition >= 2
    ? 'repeated-problem-spec'
    : source >= 2 && roadmap >= 1
      ? 'roadmap-from-signal'
      : 'problem-signal-check';

  return {
    applies: true,
    reason: 'source the roadmap from repeated user/community problems, not an invented feature list',
    score,
    layer,
    signals: { roadmap: roadmap, source: source, repetition: repetition, frame: frame }
  };
}

function repeatedProblemSignalMiningPromptBlock(message) {
  const classification = classifyRepeatedProblemSignalMining(message);
  if (!classification.applies) return '';

  return '[REPEATED-PROBLEM SIGNAL MINING]\n'
    + 'This request is deciding what to build/ship/prioritize. Source the roadmap from repeated real problems instead of an invented feature.\n'
    + '- Field / community surface: name where the problems actually surface (community, workspace, workbench users, issues, support intake) and who reports them.\n'
    + '- Rank the repeated problems: list the problems reported repeatedly, most-repeated first — the repetition is what makes it a spec, not noise.\n'
    + '- Most-repeated problem -> requirement: state the top repeated problem as the concrete requirement the next build answers.\n'
    + '- Proof / case artifacts: name the real examples, artifacts, or cases that demonstrate the problem, so the requirement is evidenced rather than assumed.\n'
    + '- Demand path and talent path: name how that community reaches the product (funnel) and how it supplies capable operators/builders (talent), so the same source is not purely an audience.\n'
    + '- Next build/scale step: pick the smallest next step that answers the top problem, and say whether the demonstrated demand now needs distribution rather than more building.\n'
    + '- Verdict: repeated-problem-sourced (the build answers a repeated reported problem) vs. invented-feature (no repeated signal behind it — defer or validate first).\n'
    + '- Keep it proportional: a short ranked list, the requirement, and the next step is enough; do not turn a small build choice into a market study.\n'
    + '[/REPEATED-PROBLEM SIGNAL MINING]';
}

function appendRepeatedProblemSignalMiningPrompt(message) {
  const block = repeatedProblemSignalMiningPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyRepeatedProblemSignalMining,
  repeatedProblemSignalMiningPromptBlock,
  appendRepeatedProblemSignalMiningPrompt
};
