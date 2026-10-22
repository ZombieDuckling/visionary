'use strict';

// Deterministic augmentation-means nudge for requests that add a capability or
// build tooling without naming the other augmentation means. Inspired by Jake Van
// Clief's Engelbart lesson (video 2aUUAi4DI0k, concept augmentation-means-stack):
// Engelbart's 1962 framework names four augmentation means that must all be
// present — artifacts, language, methodology, training (H-LAM/T) — and
// "intelligence is the organization of complexity toward a goal, not the
// complexity itself." Shipping tools (artifacts) with no methodology or training
// and calling it augmentation degrades to bare automation or tool-chasing.
//
// This is the *anatomy* layer behind the augment-over-automate disposition. It is
// distinct from the augment-over-automate nudge (which fires on riderless
// automation claims and removes-the-human framing) and from program-decomposition
// (which decomposes AI-as-worker into instructions/runner/state/hand-back). This
// nudge fires when the operator is about to add a tool, feature, agent, dashboard,
// or capability and has not named the methodology, language, and training that
// make it genuine augmentation — the "feature bloat is not intelligence" failure.

const TOOLING_TERMS = [
  'tool', 'tools', 'tooling', 'feature', 'features', 'capability', 'capabilities',
  'dashboard', 'platform', 'interface', 'integration', 'integrations',
  'connector', 'connectors', 'plugin', 'plugins', 'agent', 'agents',
  'workbench', 'widget', 'widgets', 'panel', 'panels', 'product', 'offer', 'service'
];

const BUILD_TERMS = [
  'build', 'builds', 'building', 'make', 'makes', 'making', 'create', 'creates',
  'creating', 'add', 'adds', 'adding', 'ship', 'ships', 'shipping', 'launch',
  'launching', 'new', 'more', 'another', 'scale', 'scaling', 'improve',
  'improving', 'design', 'designing', 'stand up', 'bring in'
];

const AUGMENT_CLAIM_TERMS = [
  'augment', 'augmentation', 'amplify', 'amplifies', 'amplified intelligence',
  'multiply the human', 'amplify the human'
];

const MEANS_NAMED_TERMS = [
  'methodology', 'method', 'procedure', 'procedures', 'sop', 'sops',
  'runbook', 'runbooks', 'playbook', 'playbooks', 'glossary', 'schema', 'schemas',
  'checklist', 'checklists', 'walkthrough', 'walkthroughs', 'onboarding',
  'training', 'train', 'teach', 'teaches', 'documentation', 'documented',
  'rubric', 'rubrics', 'standard', 'standards', 'guideline', 'guidelines',
  'example', 'examples', 'context package', 'how we work', 'how it works',
  'artifact', 'artifacts'
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-word matching (not naive substring) so short terms like "add", "new",
// and "stand" cannot false-match inside words such as "address" or "standard".
function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    const pattern = new RegExp('\\b' + escapeRegExp(term) + '\\b');
    return pattern.test(text) ? count + 1 : count;
  }, 0);
}

function classifyAugmentationMeans(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const tooling = countMatches(text, TOOLING_TERMS);
  const build = countMatches(text, BUILD_TERMS);
  const augmentClaim = countMatches(text, AUGMENT_CLAIM_TERMS);
  const meansNamed = countMatches(text, MEANS_NAMED_TERMS);

  if (tooling === 0 && augmentClaim === 0) {
    return { applies: false, reason: 'not a tooling-first capability request', score: build };
  }
  if (meansNamed >= 2) {
    return { applies: false, reason: 'augmentation means already named', score: tooling + build + augmentClaim };
  }
  if (tooling === 0) {
    if (meansNamed === 0) {
      return {
        applies: true,
        reason: 'augmentation claimed but no means named; label artifacts, language, methodology, and training before calling it augmentation',
        score: augmentClaim,
        layer: 'augmentation-claim-without-means',
        signals: { tooling: tooling, build: build, augment_claim: augmentClaim, means_named: meansNamed }
      };
    }
    return { applies: false, reason: 'partial means present', score: augmentClaim };
  }

  const strength = tooling + build + augmentClaim;
  if (strength < 2) {
    return { applies: false, reason: 'weak tooling-first signal', score: strength };
  }

  const layer = augmentClaim >= 1
    ? 'augmentation-claim-without-means'
    : 'tooling-first-build';

  return {
    applies: true,
    reason: 'a capability/tool is being added without the other augmentation means; label artifacts, language, methodology, and training before shipping',
    score: strength,
    layer,
    signals: { tooling: tooling, build: build, augment_claim: augmentClaim, means_named: meansNamed }
  };
}

function augmentationMeansPromptBlock(message) {
  const classification = classifyAugmentationMeans(message);
  if (!classification.applies) return '';

  return '[AUGMENTATION-MEANS CHECK]\n'
    + 'This request adds a tool, feature, agent, or capability. Tools alone do not augment — Engelbart\'s four means must all be present, and intelligence is the organization of complexity toward a goal, not the complexity itself. Before shipping, label each means present, weak, or missing:\\n'
    + '- Artifacts: the concrete objects the operator works through — files, folders, scripts, connectors, interfaces, hardware. A chat box alone is not enough.\\n'
    + '- Language: the concepts and symbols that let intent be stated precisely and reused — context packages, prompt schemas, glossaries, naming, ontology. Not re-explained each session.\\n'
    + '- Methodology: the goal-centered procedure with order-of-operations and exception handling — SOPs, routing maps, gates, verification loops.\\n'
    + '- Training: what makes a fresh operator or session effective with the means above — onboarding, examples and anti-examples, checklists, walkthroughs, ledgers.\\n'
    + '- Rule: if any means is missing, the outcome degrades to bare automation or tool-chasing. Build the missing means instead of adding more capabilities to compensate.\\n'
    + '- Higher-order role: after each automation step, name the higher-order role the human now owns — never treat the human as removed.\\n'
    + '- Primitives and composition: expose a small reliable set of primitives and compose them; do not hard-code one-off ends or grow a feature inventory.\\n'
    + '- Organization toward goal: state who is augmented, why, and the hand-back point — and judge by intent + organization + problem fit, not model size, feature count, or agent count.\\n'
    + '- Verdict: genuine augmentation, bare automation, or tool-chasing — and whether to prefer \"amplified intelligence\" framing over \"artificial intelligence\".\\n'
    + '[/AUGMENTATION-MEANS CHECK]';
}

function appendAugmentationMeansPrompt(message) {
  const block = augmentationMeansPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyAugmentationMeans,
  augmentationMeansPromptBlock,
  appendAugmentationMeansPrompt
};
