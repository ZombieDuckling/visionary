'use strict';

// Deterministic participatory-governance readiness scanner for projects.
// Inspired by Jake Van Clief's affected-user governance workbench pattern:
// consequential AI/workflow products need named stakeholders, decision rights,
// ranked proposals, implementation evidence, and eval cases — not vague feedback.

const SIGNALS = [
  { id: 'affected-users', weight: 3, pattern: /\b(users?|customers?|clients?|students?|teachers?|patients?|staff|operators?|community|communities|stakeholders?|members?|learners?|employees?)\b/i },
  { id: 'education', weight: 4, pattern: /\b(edtech|education|school|schools|classroom|curriculum|teacher|student|learning|learners?|assessment|university)\b/i },
  { id: 'sensitive-domain', weight: 4, pattern: /\b(finance|financial|investment|portfolio|legal|medical|health|security|cyber|privacy|compliance|risk|safety|identity|personal data|pii)\b/i },
  { id: 'ai-decisioning', weight: 3, pattern: /\b(ai|agent|agents|automation|automated|model|llm|recommendation|ranking|scoring|decision|triage|classifier)\b/i },
  { id: 'trust-adoption', weight: 2, pattern: /\b(trust|adoption|approval|review|governance|rubric|policy|ethics|fairness|bias|consent|feedback)\b/i },
  { id: 'external-workflow', weight: 2, pattern: /\b(client|customer|team|department|org|organisation|organization|public|market|sales|support|workflow)\b/i }
];

const CHECKLIST = [
  'Name the affected user groups and edge-case users.',
  'State who has decision rights versus who only gives feedback.',
  'Collect representative source material, examples, and disagreements.',
  'Convert discussion into concrete proposals/spec/rubric/eval cases.',
  'Rank proposals by impact, feasibility, risk/ethics, adoption, and cost.',
  'Record accepted/rejected/deferred decisions with rationale and links.',
  'Re-check outcomes after implementation, not just attendance or sentiment.'
];

function textFor(project, tasks) {
  const chunks = [];
  if (project) chunks.push(project.name, project.description, project.slug);
  (tasks || []).forEach((t) => chunks.push(t.title, t.description, t.agent_id, t.status, t.priority));
  return chunks.filter(Boolean).join('\n');
}

function matchedSnippets(text, pattern, max = 3) {
  const snippets = [];
  const lines = String(text || '').split(/\n+/);
  for (const line of lines) {
    if (pattern.test(line)) {
      snippets.push(line.trim().slice(0, 160));
      if (snippets.length >= max) break;
    }
  }
  return snippets;
}

function analyzeGovernanceNeed(project, tasks) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const text = textFor(project, taskList);
  const triggers = [];
  let score = 0;

  for (const signal of SIGNALS) {
    signal.pattern.lastIndex = 0;
    if (signal.pattern.test(text)) {
      score += signal.weight;
      triggers.push({
        id: signal.id,
        weight: signal.weight,
        snippets: matchedSnippets(text, signal.pattern)
      });
    }
  }

  const activeTasks = taskList.filter((t) => t.status !== 'done').length;
  if (activeTasks >= 3) {
    score += 1;
    triggers.push({ id: 'active-workload', weight: 1, snippets: [String(activeTasks) + ' active task(s)'] });
  }

  const recommended = score >= 7 || (
    triggers.some((t) => t.id === 'affected-users')
    && triggers.some((t) => t.id === 'ai-decisioning' || t.id === 'sensitive-domain')
  );

  let level = 'low';
  if (recommended && score >= 10) level = 'high';
  else if (recommended) level = 'medium';

  return {
    recommended,
    level,
    score,
    trigger_count: triggers.length,
    triggers,
    checklist: CHECKLIST.slice(),
    next_action: recommended
      ? 'Create a lightweight decision ledger before productizing or dispatching more autonomous work.'
      : 'No governance workbench needed yet; keep normal artifact/review hygiene.'
  };
}

function buildGovernanceWatchlist(projects, tasksByProject, limit = 3) {
  return (projects || []).map((project) => {
    const tasks = (tasksByProject && tasksByProject[project.id]) || [];
    const analysis = analyzeGovernanceNeed(project, tasks);
    return { project, analysis, active_task_count: tasks.filter((t) => t.status !== 'done').length };
  })
    .filter((entry) => entry.analysis.recommended)
    .sort((a, b) => b.analysis.score - a.analysis.score || b.active_task_count - a.active_task_count)
    .slice(0, limit)
    .map((entry) => ({
      project_id: entry.project.id,
      project_name: entry.project.name,
      project_slug: entry.project.slug,
      score: entry.analysis.score,
      level: entry.analysis.level,
      active_task_count: entry.active_task_count,
      triggers: entry.analysis.triggers.map((t) => t.id),
      next_action: entry.analysis.next_action
    }));
}

module.exports = {
  SIGNALS,
  CHECKLIST,
  analyzeGovernanceNeed,
  buildGovernanceWatchlist
};
