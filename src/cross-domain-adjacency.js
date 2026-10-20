'use strict';

// Deterministic cross-domain adjacency nudge for learning/build-selection
// requests — "what should I learn next", "pick the next skill", "what do I
// build next", "add a skill to the roadmap". Inspired by Jake Van Clief's
// cross-domain eureka lesson (video NvJGe4cV1kE, concept cross-domain-eureka-ledger):
// existing interests act as a discount on the next adjacent skill, so the next
// learning/build target should be chosen at the overlap where the operator
// already has a head start, and each observed boost should be captured in a
// durable ledger rather than evaporating. Generic "high value"/"AI is valuable"
// rankings ignore that head start and treat every skill as a zero-base start.
//
// This is distinct from the opportunity-routing nudge (which fires on *market*
// value — buyer, pain, capacity, proof) and the ai-workflow-ladder nudge (which
// promotes a repeated workflow into files/scripts). This nudge fires on
// *learning-selection*: which skill or build to pick next, and why that pick is
// cheapest given what the operator already carries.

const LEARNING_TERMS = [
  'learn', 'learning', 'skill', 'skills', 'upskill', 'up-skill', 'reskill',
  'study', 'curriculum', 'course', 'certification', 'tutorial', 'practice',
  'get better at', 'level up', 'pick up', 'pick-up', 'deepen', 'specialize',
  'specialise', 'master', 'novice', 'new stack', 'new technology',
  'new tech', 'new tool', 'new toolset', 'new framework', 'new language',
  'adopt', 'onboarding', 'training'
];

const SELECTION_TERMS = [
  'what should i learn', 'what to learn', 'what should i build',
  'what to build', 'build next', 'learn next', 'skill next', 'next skill',
  'next thing', 'next target', 'next up', 'up next', 'choose', 'pick',
  'prioritize', 'prioritise', 'rank', 'recommend', 'roadmap', 'backlog',
  'where to invest', 'where should i', 'decide what', 'which should i',
  'plan the next', 'pick the next', 'select', 'decide between'
];

const ADJACENCY_TERMS = [
  'adjacent', 'adjacency', 'overlap', 'overlaps', 'transfer', 'transfers',
  'cross-domain', 'cross domain', 'eureka', 'head start', 'head-start',
  'already know', 'already have', 'existing skills', 'existing experience',
  'existing knowledge', 'leverage my', 'builds on', 'build on', 'stack on',
  'from my experience', 'background in', 'compound', 'synergy', 'synergies',
  'what i already', 'interests', 'hobbies', 'translate my'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyCrossDomainAdjacency(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const learning = countMatches(text, LEARNING_TERMS);
  const selection = countMatches(text, SELECTION_TERMS);
  const adjacency = countMatches(text, ADJACENCY_TERMS);

  if (learning === 0 && selection === 0) {
    return { applies: false, reason: 'not a learning/build-selection request', score: 0 };
  }
  if (adjacency >= 2) {
    return { applies: false, reason: 'adjacency frame already present', score: learning + selection };
  }
  if (learning === 0) {
    return { applies: false, reason: 'no learning/build target named', score: selection };
  }
  if (selection === 0 && learning < 2) {
    return { applies: false, reason: 'weak learning signal', score: learning };
  }

  const layer = selection >= 1
    ? 'next-skill-selection'
    : 'learning-target-request';

  return {
    applies: true,
    reason: 'learning/build target being chosen; name the cross-domain adjacency that discounts it before ranking by generic value',
    score: learning + selection,
    layer,
    signals: { learning, selection, adjacency }
  };
}

function crossDomainAdjacencyPromptBlock(message) {
  const classification = classifyCrossDomainAdjacency(message);
  if (!classification.applies) return '';

  return '[CROSS-DOMAIN ADJACENCY CHECK]\n'
    + 'This request picks a learning or build target. Existing interests act as a discount on the next adjacent skill, so the cheapest target is the one that overlaps what the operator already carries — not the one with the highest generic "value" score. Before recommending a target, answer these:\n'
    + '- Domains already carried: list the operator\'s existing skills, hobbies, and lived context that could discount a next step.\n'
    + '- The adjacency: name the two existing domains this target sits between and the concrete transfer — what prior ability lowers the cost of learning/building it.\n'
    + '- Score by transfer discount: rank candidates by how much existing context reduces the cost, not by headline value or "AI is valuable" lists; treat every skill as zero-base only after checking for a head start.\n'
    + '- Choose the overlap deliberately: prefer the option existing interests already discount over a cold-start skill of similar nominal value; keep genuinely orthogonal high-value skills as explicit exceptions, not accidental omissions.\n'
    + '- Capture eurekas when they fire: record each observed cross-domain boost in a durable ledger (domain A → domain B, the transfer that got cheaper, dated evidence) so boosts compound instead of evaporating.\n'
    + '- Verify: the chosen target names the overlap and the transfer, and the ledger records observed, dated boosts rather than vague intent.\n'
    + '[/CROSS-DOMAIN ADJACENCY CHECK]';
}

function appendCrossDomainAdjacencyPrompt(message) {
  const block = crossDomainAdjacencyPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyCrossDomainAdjacency,
  crossDomainAdjacencyPromptBlock,
  appendCrossDomainAdjacencyPrompt
};
