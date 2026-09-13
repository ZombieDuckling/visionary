'use strict';

// Deterministic learning-loop nudge for dispatches that ask an agent to teach,
// explain, train, or create learning material. Inspired by Jake Van Clief's
// "no AI cheat code for learning fast" lesson: AI can compress access to
// information, but durable skill still needs active reps, feedback, artifacts,
// and a proof that the learner can perform without the model carrying them.

const LEARNING_TERMS = [
  'learn', 'learning', 'study', 'studying', 'teach', 'teaching', 'train', 'training',
  'course', 'curriculum', 'lesson', 'lessons', 'tutorial', 'guide', 'explain',
  'understand', 'master', 'upskill', 'practice', 'onboard', 'onboarding'
];

const OUTPUT_TERMS = [
  'make', 'create', 'write', 'draft', 'generate', 'build', 'design', 'plan',
  'summarize', 'summary', 'explain', 'outline', 'walkthrough', 'roadmap',
  'teach me', 'show me', 'help me'
];

const PRACTICE_FRAME_TERMS = [
  'exercise', 'exercises', 'drill', 'drills', 'quiz', 'test', 'tests',
  'assignment', 'homework', 'rubric', 'feedback', 'reps', 'practice task',
  'checklist', 'evaluation', 'eval', 'proof', 'project', 'artifact',
  'worked example', 'failure mode', 'mistake', 'mistakes'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyLearningLoop(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const learningMatches = countMatches(text, LEARNING_TERMS);
  const outputMatches = countMatches(text, OUTPUT_TERMS);
  const practiceFrameMatches = countMatches(text, PRACTICE_FRAME_TERMS);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const shortPrompt = wordCount <= 24;
  const score = (learningMatches * 3) + outputMatches + (shortPrompt ? 2 : 0) - (practiceFrameMatches * 2);

  if (learningMatches === 0) {
    return { applies: false, reason: 'no learning signal', score };
  }
  if (practiceFrameMatches >= 2) {
    return { applies: false, reason: 'operator already supplied practice/feedback frame', score };
  }
  if (outputMatches === 0 && score < 6) {
    return { applies: false, reason: 'weak learning-loop signal', score };
  }
  if (score < 5) {
    return { applies: false, reason: 'specific enough for direct execution', score };
  }

  const layer = text.indexOf('course') !== -1 || text.indexOf('curriculum') !== -1 || text.indexOf('training') !== -1
    ? 'curriculum-with-reps'
    : shortPrompt || text.indexOf('explain') !== -1 || text.indexOf('teach me') !== -1
      ? 'active-learning-loop'
      : 'lightweight-practice-check';

  return {
    applies: true,
    reason: 'learning requests should require active practice and feedback, not passive explanation only',
    score,
    layer,
    signals: {
      learning: learningMatches,
      output: outputMatches,
      practice_frame: practiceFrameMatches,
      word_count: wordCount
    }
  };
}

function learningLoopPromptBlock(message) {
  const classification = classifyLearningLoop(message);
  if (!classification.applies) return '';

  return '[LEARNING-LOOP CHECK]\n'
    + 'This is a learning/training request. Do not treat explanation as mastery; design the smallest active loop that proves transfer.\n'
    + '- Target skill: name the exact thing the learner should be able to do afterward, not just know about.\n'
    + '- Current level assumption: state the assumed starting point and keep the path proportional.\n'
    + '- Active reps: include at least one exercise, drill, mini-project, or decision task the learner must perform.\n'
    + '- Feedback path: give a rubric, expected output, common mistakes, or self-check so performance can be judged.\n'
    + '- Transfer proof: name the artifact, test, or real-world action that shows the learner can do it without passively rereading AI output.\n'
    + 'Keep it compact and still deliver the requested explanation/material.\n'
    + '[/LEARNING-LOOP CHECK]';
}

function appendLearningLoopPrompt(message) {
  const block = learningLoopPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyLearningLoop,
  learningLoopPromptBlock,
  appendLearningLoopPrompt
};
