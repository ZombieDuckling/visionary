'use strict';

// Deterministic reusable-workflow nudge for dispatches that ask an agent to
// create or improve a skill, template, playbook, SOP, checklist, or repeated
// workflow. Inspired by Jake Van Clief's markdown-skills lesson: stable AI work
// should become a small portable markdown file with examples and revision notes,
// not another one-off chat prompt.

const WORKFLOW_TERMS = [
  'workflow', 'process', 'procedure', 'sop', 'playbook', 'runbook', 'checklist',
  'operating guide', 'standard operating', 'repeatable', 'recurring', 'every time',
  'template', 'skill', 'skills', 'instruction', 'instructions', 'prompt', 'prompts'
];

const BUILD_TERMS = [
  'create', 'build', 'write', 'draft', 'make', 'turn into', 'convert', 'codify',
  'capture', 'document', 'improve', 'update', 'refine', 'version', 'generalize'
];

const PORTABILITY_TERMS = [
  'markdown', 'md', 'file', 'files', 'folder', 'repo', 'portable', 'export',
  'reuse', 'reusable', 'examples', 'test case', 'test cases', 'truth deck',
  'pressure-test', 'pressure test', 'versioned'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyWorkflowSkillTemplate(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const workflowMatches = countMatches(text, WORKFLOW_TERMS);
  const buildMatches = countMatches(text, BUILD_TERMS);
  const portabilityMatches = countMatches(text, PORTABILITY_TERMS);
  const score = (workflowMatches * 3) + (buildMatches * 2) + portabilityMatches;

  if (workflowMatches === 0 || buildMatches === 0) {
    return { applies: false, reason: 'not reusable-workflow shaped', score };
  }
  if (score < 7) {
    return { applies: false, reason: 'weak reusable-workflow signal', score };
  }

  const layer = text.indexOf('skill') !== -1 || text.indexOf('instructions') !== -1 || text.indexOf('prompt') !== -1
    ? 'portable-markdown-skill'
    : text.indexOf('template') !== -1 || text.indexOf('playbook') !== -1 || text.indexOf('sop') !== -1
      ? 'reusable-workflow-template'
      : 'workflow-capture';

  return {
    applies: true,
    reason: 'repeatable work should become a portable markdown workflow asset',
    score,
    layer,
    signals: {
      workflow: workflowMatches,
      build: buildMatches,
      portability: portabilityMatches
    }
  };
}

function workflowSkillTemplatePromptBlock(message) {
  const classification = classifyWorkflowSkillTemplate(message);
  if (!classification.applies) return '';

  return '[WORKFLOW-SKILL-TEMPLATE CHECK]\n'
    + 'This looks like repeatable workflow or skill work. Before producing a one-off answer, make the reusable asset explicit and keep it readable by any capable AI.\n'
    + '- Canonical markdown: name the single source file or folder where the workflow/skill/template should live.\n'
    + '- Scope boundary: say what cases it is for, what cases it is not for, and the inputs the next agent needs.\n'
    + '- Procedure: write concise steps, decision points, examples, and must-avoid failure modes instead of vague prompting advice.\n'
    + '- Pressure test: include at least one representative example or truth-deck case that would catch a bad generalized workflow.\n'
    + '- Revision loop: leave version/date/change notes or acceptance criteria so the workflow improves after each real use.\n'
    + 'Do not invent a heavy platform around it unless plain markdown plus artifacts cannot satisfy continuity, review, permissions, or telemetry.\n'
    + '[/WORKFLOW-SKILL-TEMPLATE CHECK]';
}

function appendWorkflowSkillTemplatePrompt(message) {
  const block = workflowSkillTemplatePromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyWorkflowSkillTemplate,
  workflowSkillTemplatePromptBlock,
  appendWorkflowSkillTemplatePrompt
};
