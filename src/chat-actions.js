// Chat action parsing — the markers Argus emits to command the dashboard.
//
// parseChatActions(text) -> {
//   creates:    [{ title, description, agent, priority }],
//   moves:      [{ taskId, status }],
//   dispatches: [{ taskId, agent }]
// }
//
// Deliberately tolerant: models wrap markers in bullets, bold, or code, use
// status synonyms ("wip"), and may emit several actions in one reply — every
// occurrence is parsed, anywhere in the text. The instruction template itself
// ("CREATE_TASK: title | description | …") is never treated as an action.

const STATUS_SYNONYMS = {
  todo: 'todo', backlog: 'todo', 'to-do': 'todo', 'to_do': 'todo',
  in_progress: 'in_progress', 'in-progress': 'in_progress', inprogress: 'in_progress',
  'in progress': 'in_progress', wip: 'in_progress', doing: 'in_progress', active: 'in_progress',
  review: 'review', 'in review': 'review', 'in_review': 'review',
  done: 'done', complete: 'done', completed: 'done', finished: 'done', closed: 'done'
};

const VALID_PRIORITIES = ['critical', 'high', 'medium', 'low'];

function clean(s) {
  return String(s || '').replace(/[*`]+/g, '').trim();
}

function normalizeStatus(raw) {
  return STATUS_SYNONYMS[clean(raw).toLowerCase()] || null;
}

function parseChatActions(text) {
  const src = String(text || '');
  const creates = [];
  const moves = [];
  const dispatches = [];

  for (const m of src.matchAll(/CREATE_TASK:\s*([^|\n]+)\|([^|\n]*)(?:\|([^|\n]*))?(?:\|([^|\n]*))?/gi)) {
    const title = clean(m[1]);
    const description = clean(m[2]);
    const agent = clean(m[3]).toLowerCase() || null;
    const priorityRaw = clean(m[4]).toLowerCase();
    // Skip the echoed instruction template.
    if (title.toLowerCase() === 'title' && description.toLowerCase() === 'description') continue;
    if (!title) continue;
    creates.push({
      title,
      description: description && description !== '-' ? description : null,
      agent: agent && agent !== 'agent_id' ? agent : null,
      priority: VALID_PRIORITIES.includes(priorityRaw) ? priorityRaw : 'medium'
    });
  }

  for (const m of src.matchAll(/MOVE_TASK:\s*#?(\d+)\s*\|\s*([\w -]+)/gi)) {
    const status = normalizeStatus(m[2]);
    if (status) moves.push({ taskId: parseInt(m[1], 10), status });
  }

  for (const m of src.matchAll(/DISPATCH_TASK:\s*#?(\d+)\s*\|\s*([\w-]+)/gi)) {
    const agent = clean(m[2]).toLowerCase();
    if (agent && agent !== 'agent_id') dispatches.push({ taskId: parseInt(m[1], 10), agent });
  }

  return { creates, moves, dispatches };
}

module.exports = { parseChatActions, normalizeStatus };
