import test from 'node:test';
import assert from 'node:assert/strict';
import chatActions from '../src/chat-actions.js';

const { parseChatActions, normalizeStatus } = chatActions;

test('parseChatActions ignores echoed instruction templates', () => {
  const parsed = parseChatActions(`ACTIONS:\nCREATE_TASK: title | description | agent_id | priority\nMOVE_TASK: task_id | todo|in_progress|review|done`);
  assert.deepEqual(parsed.creates, []);
  assert.deepEqual(parsed.moves, []);
  assert.deepEqual(parsed.dispatches, []);
});

test('parseChatActions extracts multiple task actions from a reply', () => {
  const parsed = parseChatActions(`I'll coordinate this.\nCREATE_TASK: Build continuity drawer | Show current chat/session/task context | coder | High\nCREATE_TASK: Add review copy | - | designer | urgent\nMOVE_TASK: #42 | wip\nDISPATCH_TASK: 42 | coder\nDISPATCH_TASK: #43 | agent_id`);

  assert.deepEqual(parsed.creates, [
    {
      title: 'Build continuity drawer',
      description: 'Show current chat/session/task context',
      agent: 'coder',
      priority: 'high'
    },
    {
      title: 'Add review copy',
      description: null,
      agent: 'designer',
      priority: 'medium'
    }
  ]);
  assert.deepEqual(parsed.moves, [{ taskId: 42, status: 'in_progress' }]);
  assert.deepEqual(parsed.dispatches, [{ taskId: 42, agent: 'coder' }]);
});

test('normalizeStatus accepts operator-friendly synonyms', () => {
  assert.equal(normalizeStatus('in progress'), 'in_progress');
  assert.equal(normalizeStatus('complete'), 'done');
  assert.equal(normalizeStatus('backlog'), 'todo');
  assert.equal(normalizeStatus('unknown'), null);
});
