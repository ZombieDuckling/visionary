'use strict';

// Deterministic failure-study nudge for debug, incident, broken-build, and
// post-failure prompts. Inspired by Jake Van Clief's lesson that failure is the
// fastest way to learn what to study: a useful agent should extract the missing
// concept and durable practice artifact while still fixing the immediate issue.

const FAILURE_TERMS = [
  'fail', 'fails', 'failed', 'failure', 'failing', 'broken', 'breaks', 'bug', 'bugs',
  'error', 'errors', 'exception', 'crash', 'crashes', 'regression', 'incident',
  'outage', 'stuck', 'blocked', 'blocker', 'debug', 'diagnose', 'triage', 'fix'
];

const STUDY_TERMS = [
  'learn', 'lesson', 'lessons', 'study', 'understand', 'root cause', 'postmortem',
  'retrospective', 'prevent', 'prevention', 'improve', 'mistake', 'mistakes',
  'why', 'pattern', 'recurring', 'again', 'repeat'
];

const DELIVERY_TERMS = [
  'fix', 'patch', 'repair', 'resolve', 'unblock', 'ship', 'test', 'verify',
  'implement', 'update', 'change', 'make it work', 'recover'
];

const EXISTING_FRAME_TERMS = [
  'root cause', 'repro steps', 'postmortem', 'runbook', 'regression test',
  'failing test', 'evidence trail', 'rollback plan', 'prevention plan'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyFailureStudyLoop(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const failures = countMatches(text, FAILURE_TERMS);
  const study = countMatches(text, STUDY_TERMS);
  const delivery = countMatches(text, DELIVERY_TERMS);
  const existingFrame = countMatches(text, EXISTING_FRAME_TERMS);
  const score = (failures * 3) + (study * 2) + delivery - (existingFrame * 3);

  if (failures === 0) {
    return { applies: false, reason: 'no failure/debug signal', score };
  }
  if (existingFrame >= 2) {
    return { applies: false, reason: 'operator already supplied failure-analysis frame', score };
  }
  if (score < 6) {
    return { applies: false, reason: 'weak failure-study signal', score };
  }

  const layer = study >= 2
    ? 'post-failure-learning-loop'
    : failures >= 3
      ? 'debug-with-root-cause'
      : 'fix-with-learning-artifact';

  return {
    applies: true,
    reason: 'failure/debug work should convert the breakage into root-cause evidence and a reusable learning asset',
    score,
    layer,
    signals: { failures, study, delivery, existing_frame: existingFrame }
  };
}

function failureStudyLoopPromptBlock(message) {
  const classification = classifyFailureStudyLoop(message);
  if (!classification.applies) return '';

  return '[FAILURE-STUDY LOOP]\n'
    + 'This is failure/debug/incident-shaped work. Fix the immediate issue, but also use the failure to identify what must be learned or made durable. Keep this brief and then execute.\n'
    + '- Evidence first: name the observed failure, exact error/log/test/source, reproduction path, and what is still unknown.\n'
    + '- Missing concept: state the smallest concept, dependency, invariant, or workflow assumption the failure exposed.\n'
    + '- Fix path: make the smallest safe change, add or run the most relevant verification, and avoid broad rewrites unless evidence requires them.\n'
    + '- Study artifact: save or propose one reusable note, test, checklist, runbook entry, or regression case so the next agent does not rediscover it.\n'
    + '- Transfer check: name how a future operator can tell the lesson stuck — passing test, reproduced command, updated docs, or monitored signal.\n'
    + '[/FAILURE-STUDY LOOP]';
}

function appendFailureStudyLoopPrompt(message) {
  const block = failureStudyLoopPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyFailureStudyLoop,
  failureStudyLoopPromptBlock,
  appendFailureStudyLoopPrompt
};
