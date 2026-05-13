/* ============================================
   Visionary Mission Control - Frontend App
   Proxy-based reactive state store, SSE,
   tab router, task board, agent cards,
   dispatch engine, activity feed, kill switch
   ============================================ */

(function () {
  'use strict';

  // --- HTML Escape Utility (XSS prevention) ---
  // All dynamic strings MUST go through this before innerHTML insertion.
  // Replaces &, <, >, " with HTML entities. Returns '' for null/undefined.
  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --- Time Ago Helper ---
  function timeAgo(dateStr) {
    if (!dateStr) return '';
    var diff = Date.now() - Date.parse(dateStr);
    if (diff < 0) return 'just now';
    var seconds = Math.floor(diff / 1000);
    if (seconds < 60) return seconds + 's ago';
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm ago';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.floor(hours / 24);
    return days + 'd ago';
  }

  // --- Elapsed Time Formatter ---
  function formatElapsed(ms) {
    if (!ms || ms < 1000) return '0s';
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60);
    return m + 'm ' + (s % 60) + 's';
  }

  // --- Agent Color Map ---
  var AGENT_COLORS = {
    jarvis: '#3b8bff', scout: '#06b6d4', analyst: '#7c5cff', forge: '#f59e0b',
    sentinel: '#ef4444', broker: '#22c55e', ops: '#8b5cf6', hunter: '#ec4899'
  };

  // --- Reactive State Store (Proxy-based) ---
  var _state = {
    tasks: [],
    activity: [],
    notifications: [],
    agents: [],
    activeRuns: [],
    activeTab: 'board',
    sseConnected: false
  };

  var _listeners = {};

  var state = new Proxy(_state, {
    set: function (target, prop, value) {
      var oldValue = target[prop];
      target[prop] = value;
      if (_listeners[prop]) {
        _listeners[prop].forEach(function (fn) {
          fn(value, oldValue);
        });
      }
      return true;
    }
  });

  function onChange(prop, fn) {
    if (!_listeners[prop]) {
      _listeners[prop] = [];
    }
    _listeners[prop].push(fn);
  }

  // --- Fetch Helpers ---
  async function api(path, options) {
    var opts = Object.assign({}, options || {});
    var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (opts.body && typeof opts.body === 'object') {
      opts.body = JSON.stringify(opts.body);
    }
    opts.headers = headers;
    var res = await fetch('/api' + path, opts);
    var data = await res.json();
    if (!res.ok) {
      var err = new Error('API error: ' + res.status);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function loadTasks() {
    var tasks = await api('/tasks');
    state.tasks = tasks;
  }

  async function loadActivity() {
    var activity = await api('/activity?limit=50');
    state.activity = activity;
  }

  async function loadAgents() {
    var data = await api('/agents');
    state.agents = data.agents || [];
  }

  // --- SSE Connection ---
  function connectSSE() {
    var source = new EventSource('/api/events');

    source.onopen = function () {
      state.sseConnected = true;
    };

    source.onerror = function () {
      state.sseConnected = false;
    };

    source.addEventListener('task:created', function (e) {
      var task = JSON.parse(e.data);
      state.tasks = [].concat(state.tasks, [task]);
    });

    source.addEventListener('task:updated', function (e) {
      var updated = JSON.parse(e.data);
      state.tasks = state.tasks.map(function (t) {
        return t.id === updated.id ? updated : t;
      });
    });

    source.addEventListener('task:deleted', function (e) {
      var deleted = JSON.parse(e.data);
      state.tasks = state.tasks.filter(function (t) {
        return t.id !== deleted.id;
      });
    });

    source.addEventListener('activity:new', function (e) {
      var entry = JSON.parse(e.data);
      state.activity = [entry].concat(state.activity).slice(0, 100);
    });

    source.addEventListener('agent:status', function (e) {
      var updated = JSON.parse(e.data);
      state.agents = state.agents.map(function (a) {
        return a.id === updated.id ? Object.assign({}, a, updated) : a;
      });
    });

    // --- Agent dispatch SSE events ---

    source.addEventListener('agent:started', function (e) {
      var d = JSON.parse(e.data);
      state.activeRuns = [].concat(state.activeRuns, [{
        run_id: d.run_id, agent_id: d.agent_id, task_id: d.task_id, elapsed_ms: 0
      }]);
      loadAgents().catch(function () {});
    });

    source.addEventListener('agent:completed', function (e) {
      var d = JSON.parse(e.data);
      state.activeRuns = state.activeRuns.filter(function (r) {
        return r.run_id !== d.run_id;
      });
      loadAgents().catch(function () {});
    });

    source.addEventListener('agent:failed', function (e) {
      var d = JSON.parse(e.data);
      state.activeRuns = state.activeRuns.filter(function (r) {
        return r.run_id !== d.run_id;
      });
      loadAgents().catch(function () {});
    });

    source.addEventListener('agent:progress', function (e) {
      var d = JSON.parse(e.data);
      state.activeRuns = state.activeRuns.map(function (r) {
        if (r.run_id === d.run_id) {
          return Object.assign({}, r, { elapsed_ms: d.elapsed_ms });
        }
        return r;
      });
    });

    return source;
  }

  // --- Agent List ---
  var AGENTS = [
    { id: 'jarvis', name: 'Jarvis', role: 'Main orchestrator' },
    { id: 'scout', name: 'Scout', role: 'Research & briefs' },
    { id: 'analyst', name: 'Analyst', role: 'Data analysis' },
    { id: 'forge', name: 'Forge', role: 'Builder & coder' },
    { id: 'sentinel', name: 'Sentinel', role: 'Security audits' },
    { id: 'broker', name: 'Broker', role: 'Portfolio & finance' },
    { id: 'ops', name: 'Ops', role: 'Infrastructure' },
    { id: 'hunter', name: 'Hunter', role: 'Job hunting' }
  ];

  // --- Priority Helpers ---
  function priorityBadge(priority) {
    var map = {
      critical: 'badge-red',
      high: 'badge-orange',
      medium: 'badge-blue',
      low: 'text-muted'
    };
    var cls = map[priority] || 'badge-blue';
    return '<span class="badge ' + cls + '">' + esc(priority || 'medium') + '</span>';
  }

  function agentBadge(agentId) {
    if (!agentId) return '';
    var colorVar = '--agent-' + esc(agentId);
    return '<span class="badge" style="background: color-mix(in srgb, var(' + colorVar + ') 15%, transparent); color: var(' + colorVar + ')">' + esc(agentId) + '</span>';
  }

  // --- Status Border Color Map ---
  var STATUS_BORDER_COLOR = {
    todo: 'var(--text-muted)',
    in_progress: 'var(--accent-blue)',
    review: 'var(--accent-orange)',
    done: 'var(--accent-green)'
  };

  // --- Task Card Helper ---
  // Returns safe HTML string. All dynamic text goes through esc().
  function taskCard(task) {
    var priorityClass = task.priority ? 'priority-' + esc(task.priority) : '';
    var borderColor = STATUS_BORDER_COLOR[task.status] || 'var(--text-muted)';

    // Check if task has an active dispatch running
    var isRunning = false;
    for (var r = 0; r < state.activeRuns.length; r++) {
      if (state.activeRuns[r].task_id === task.id) { isRunning = true; break; }
    }

    var html = '<div class="board-card ' + priorityClass + '" draggable="true" data-action="view-task" data-task-id="' + esc(task.id) + '" style="border-left: 3px solid ' + borderColor + '">'
      + '<div class="board-card-title">' + esc(task.title) + '</div>'
      + '<div class="board-card-meta">'
      + priorityBadge(task.priority)
      + agentBadge(task.agent_id)
      + '<span class="text-muted">' + timeAgo(task.created_at) + '</span>'
      + '</div>';

    if (isRunning) {
      html += '<div class="task-running-indicator"><div class="spinner"></div> Running...</div>';
    }

    html += '</div>';
    return html;
  }

  // --- Render Functions ---

  // Board view: 4-column grid grouped by status
  function renderBoard(container) {
    var statuses = ['todo', 'in_progress', 'review', 'done'];
    var labels = { todo: 'To Do', in_progress: 'In Progress', review: 'Review', done: 'Done' };
    var grouped = {};
    statuses.forEach(function (s) { grouped[s] = []; });
    state.tasks.forEach(function (t) {
      var s = t.status || 'todo';
      if (grouped[s]) {
        grouped[s].push(t);
      } else {
        grouped.todo.push(t);
      }
    });

    var html = '<div class="board-header">'
      + '<h2 style="font-size: var(--font-size-lg);">Task Board</h2>'
      + '<button class="btn btn-primary" data-action="new-task">+ New Task</button>'
      + '</div>'
      + '<div class="board-grid">';

    statuses.forEach(function (s) {
      var tasks = grouped[s];
      html += '<div class="board-column" data-status="' + esc(s) + '">'
        + '<div class="board-column-header">'
        + '<span>' + esc(labels[s]) + '</span>'
        + '<span class="count">' + tasks.length + '</span>'
        + '</div>';
      tasks.forEach(function (t) {
        html += taskCard(t);
      });
      html += '</div>';
    });

    html += '</div>';

    // Use safe escaped HTML -- all dynamic content passes through esc()
    container.innerHTML = html;

    // --- Event delegation on the container ---

    // Click delegation: new-task button and view-task cards
    container.addEventListener('click', function (e) {
      var target = e.target.closest('[data-action]');
      if (!target) return;
      var action = target.getAttribute('data-action');
      if (action === 'new-task') {
        showCreateTaskForm();
      } else if (action === 'view-task') {
        var taskId = target.getAttribute('data-task-id');
        if (taskId) showTaskDetail(taskId);
      }
    });

    // --- HTML5 Drag-and-Drop via event delegation ---

    // dragstart: find closest .board-card, set transfer data, add dragging class
    container.addEventListener('dragstart', function (e) {
      var card = e.target.closest('.board-card');
      if (!card) return;
      var taskId = card.getAttribute('data-task-id');
      e.dataTransfer.setData('text/plain', taskId);
      e.dataTransfer.effectAllowed = 'move';
      // Delay adding class so the drag ghost captures the original style
      requestAnimationFrame(function () {
        card.classList.add('dragging');
      });
    });

    // dragend: clean up dragging and drag-over classes
    container.addEventListener('dragend', function () {
      var dragging = container.querySelector('.board-card.dragging');
      if (dragging) dragging.classList.remove('dragging');
      var overs = container.querySelectorAll('.board-column.drag-over');
      overs.forEach(function (col) { col.classList.remove('drag-over'); });
    });

    // dragover: allow drop on columns, add visual highlight
    container.addEventListener('dragover', function (e) {
      var column = e.target.closest('.board-column');
      if (!column) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!column.classList.contains('drag-over')) {
        // Remove drag-over from all other columns first
        var overs = container.querySelectorAll('.board-column.drag-over');
        overs.forEach(function (col) { col.classList.remove('drag-over'); });
        column.classList.add('drag-over');
      }
    });

    // dragleave: remove highlight, but only when truly leaving the column
    container.addEventListener('dragleave', function (e) {
      var column = e.target.closest('.board-column');
      if (!column) return;
      // Only remove if relatedTarget is not a child of this column
      if (!column.contains(e.relatedTarget)) {
        column.classList.remove('drag-over');
      }
    });

    // drop: move task to new column with optimistic UI update
    container.addEventListener('drop', function (e) {
      var column = e.target.closest('.board-column');
      if (!column) return;
      e.preventDefault();
      var taskId = e.dataTransfer.getData('text/plain');
      var targetStatus = column.getAttribute('data-status');

      // Clean up all drag-over highlights
      var overs = container.querySelectorAll('.board-column.drag-over');
      overs.forEach(function (col) { col.classList.remove('drag-over'); });

      if (!taskId || !targetStatus) return;

      // Find the task in state
      var taskIndex = -1;
      var currentTask = null;
      for (var i = 0; i < state.tasks.length; i++) {
        if (String(state.tasks[i].id) === String(taskId)) {
          taskIndex = i;
          currentTask = state.tasks[i];
          break;
        }
      }
      if (!currentTask) return;

      // No-op if dropped in same column
      if (currentTask.status === targetStatus) return;

      // Optimistic UI update: create new array with updated status
      var previousTasks = state.tasks.slice();
      var newSortOrder = Date.now();
      var updatedTasks = state.tasks.map(function (t) {
        if (String(t.id) === String(taskId)) {
          return Object.assign({}, t, { status: targetStatus, sort_order: newSortOrder });
        }
        return t;
      });
      state.tasks = updatedTasks;

      // Persist via PATCH -- fire-and-forget with error rollback
      api('/tasks/' + taskId, {
        method: 'PATCH',
        body: { status: targetStatus, sort_order: newSortOrder }
      }).catch(function () {
        // Revert on error
        state.tasks = previousTasks;
      });
    });
  }

  // Agents view: grid of 8 agent cards with live status + kill switch
  function renderAgents(container) {
    var agents = state.agents.length > 0 ? state.agents : AGENTS;
    var html = '<h2 style="font-size: var(--font-size-lg); margin-bottom: var(--space-lg);">Agent Desk</h2>'
      + '<div class="agent-grid">';

    agents.forEach(function (agent) {
      var colorVar = '--agent-' + esc(agent.id);
      var statusClass = agent.status || 'idle';
      // Strip date suffix from model (e.g. "claude-sonnet-4-20250514" -> "claude-sonnet-4")
      var modelDisplay = '';
      if (agent.model) {
        modelDisplay = agent.model.replace(/-\d{8}$/, '');
      }
      var lastActivity = agent.last_activity ? timeAgo(agent.last_activity) : 'No activity yet';
      var summary = agent.last_run_summary ? agent.last_run_summary.substring(0, 80) : '';

      // Check for active run on this agent
      var activeRun = null;
      for (var j = 0; j < state.activeRuns.length; j++) {
        if (state.activeRuns[j].agent_id === agent.id) {
          activeRun = state.activeRuns[j];
          break;
        }
      }

      html += '<div class="agent-card">'
        + '<div class="agent-name" style="color: var(' + colorVar + ')">'
        + '<span class="status-indicator ' + esc(statusClass) + '"></span>'
        + esc(agent.icon || '') + ' ' + esc(agent.name)
        + '</div>'
        + '<div class="agent-role">' + esc(agent.role) + '</div>'
        + '<div class="agent-model">' + esc(modelDisplay) + '</div>'
        + '<div class="agent-last-activity">' + esc(lastActivity) + '</div>';
      if (summary) {
        html += '<div class="agent-summary">' + esc(summary) + '</div>';
      }
      if (activeRun) {
        html += '<div class="agent-running">'
          + '<div class="spinner"></div>'
          + '<span>Running ' + esc(formatElapsed(activeRun.elapsed_ms)) + '</span>'
          + '<button class="btn-kill" data-action="kill-agent" data-run-id="' + esc(activeRun.run_id) + '">Kill</button>'
          + '</div>';
      }
      html += '</div>';
    });

    html += '</div>';
    // All dynamic content escaped via esc()
    container.innerHTML = html;

    // Kill button delegation
    container.addEventListener('click', function (e) {
      var killBtn = e.target.closest('[data-action="kill-agent"]');
      if (!killBtn) return;
      var runId = killBtn.getAttribute('data-run-id');
      killBtn.textContent = 'Killing...';
      killBtn.disabled = true;
      api('/dispatch/' + runId + '/kill', { method: 'POST' })
        .catch(function (err) { console.warn('Kill failed:', err); });
    });
  }

  // Activity view: list of activity entries with agent-colored borders
  function renderActivityView(container) {
    var html = '<h2 style="font-size: var(--font-size-lg); margin-bottom: var(--space-lg);">Activity</h2>';

    if (state.activity.length === 0) {
      html += '<div class="empty-state">No activity yet</div>';
      container.innerHTML = html;
      return;
    }

    html += '<div class="activity-list">';
    state.activity.forEach(function (entry) {
      var time = '';
      if (entry.created_at) {
        var d = new Date(entry.created_at);
        time = d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
      }

      // Event type badge color
      var typeCls = 'badge-blue';
      if (entry.event_type && entry.event_type.indexOf('created') !== -1) typeCls = 'badge-green';
      if (entry.event_type && entry.event_type.indexOf('deleted') !== -1) typeCls = 'badge-red';
      if (entry.event_type && entry.event_type.indexOf('updated') !== -1) typeCls = 'badge-orange';
      if (entry.event_type && entry.event_type.indexOf('dispatched') !== -1) typeCls = 'badge-blue';
      if (entry.event_type && entry.event_type.indexOf('completed') !== -1) typeCls = 'badge-green';
      if (entry.event_type && entry.event_type.indexOf('failed') !== -1) typeCls = 'badge-red';
      if (entry.event_type && entry.event_type.indexOf('timeout') !== -1) typeCls = 'badge-red';
      if (entry.event_type && entry.event_type.indexOf('killed') !== -1) typeCls = 'badge-red';

      // Agent-colored left border
      var agentColor = entry.agent_id ? (AGENT_COLORS[entry.agent_id] || 'var(--text-muted)') : '';
      var borderStyle = agentColor ? ' style="border-left: 3px solid ' + agentColor + '"' : '';

      // Agent badge
      var agentBadgeHtml = '';
      if (entry.agent_id) {
        var bgColor = 'color-mix(in srgb, ' + agentColor + ' 15%, transparent)';
        agentBadgeHtml = '<span class="activity-agent-badge" style="background: ' + bgColor + '; color: ' + agentColor + '">' + esc(entry.agent_id) + '</span>';
      }

      html += '<div class="activity-item"' + borderStyle + '>'
        + '<span class="activity-time">' + esc(time) + '</span>'
        + '<span class="badge ' + typeCls + '">' + esc(entry.event_type || 'event') + '</span>'
        + agentBadgeHtml
        + '<span class="activity-summary">' + esc(entry.summary || entry.payload || '') + '</span>'
        + '</div>';
    });
    html += '</div>';
    // All dynamic content escaped via esc()
    container.innerHTML = html;
  }

  // Inbox view: placeholder
  function renderInbox(container) {
    // Static content -- safe for innerHTML
    container.innerHTML = '<h2 style="font-size: var(--font-size-lg); margin-bottom: var(--space-lg);">Inbox</h2>'
      + '<div class="empty-state">No notifications</div>';
  }

  // --- Task Detail / Edit Overlay ---
  function showTaskDetail(taskId) {
    // Find task in state
    var task = null;
    for (var i = 0; i < state.tasks.length; i++) {
      if (String(state.tasks[i].id) === String(taskId)) {
        task = state.tasks[i];
        break;
      }
    }
    if (!task) return;

    // Remove existing overlay if present
    var existing = document.querySelector('.overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.className = 'overlay';

    // Build agent options with current selection
    var agentOptions = '<option value="">Unassigned</option>' + AGENTS.map(function (a) {
      var selected = task.agent_id === a.id ? ' selected' : '';
      return '<option value="' + esc(a.id) + '"' + selected + '>' + esc(a.name) + ' - ' + esc(a.role) + '</option>';
    }).join('');

    // Build status options
    var statusOptions = [
      { value: 'todo', label: 'To Do' },
      { value: 'in_progress', label: 'In Progress' },
      { value: 'review', label: 'Review' },
      { value: 'done', label: 'Done' }
    ].map(function (s) {
      var selected = task.status === s.value ? ' selected' : '';
      return '<option value="' + esc(s.value) + '"' + selected + '>' + esc(s.label) + '</option>';
    }).join('');

    // Build priority options
    var priorityOptions = ['critical', 'high', 'medium', 'low'].map(function (p) {
      var selected = task.priority === p ? ' selected' : '';
      return '<option value="' + esc(p) + '"' + selected + '>' + esc(p.charAt(0).toUpperCase() + p.slice(1)) + '</option>';
    }).join('');

    // Format created_at
    var createdAt = task.created_at ? new Date(task.created_at).toLocaleString('en-ZA', {
      timeZone: 'Africa/Johannesburg',
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }) : 'Unknown';

    overlay.innerHTML = '<div class="overlay-content">'
      + '<h2>Task Detail</h2>'
      + '<form id="edit-task-form">'
      + '<div class="task-detail-status">'
      + '<select name="status">' + statusOptions + '</select>'
      + '</div>'
      + '<div class="form-group">'
      + '<label>Title</label>'
      + '<input class="input" type="text" name="title" required value="' + esc(task.title) + '" />'
      + '</div>'
      + '<div class="form-group">'
      + '<label>Description</label>'
      + '<textarea class="input" name="description" rows="3">' + esc(task.description || '') + '</textarea>'
      + '</div>'
      + '<div class="form-group">'
      + '<label>Priority</label>'
      + '<select name="priority">' + priorityOptions + '</select>'
      + '</div>'
      + '<div class="form-group">'
      + '<label>Assign Agent</label>'
      + '<select name="agent_id">' + agentOptions + '</select>'
      + '</div>'
      + '<div class="task-detail-meta">Created: ' + esc(createdAt) + '</div>'
      + '<div id="form-error" class="form-error hidden"></div>'
      + '<div class="task-detail-actions">'
      + '<button type="button" class="btn btn-danger" id="delete-task-btn">Delete</button>'
      + '<button type="button" class="btn btn-dispatch" id="dispatch-task-btn">Dispatch</button>'
      + '<div class="form-actions">'
      + '<button type="button" class="btn" id="cancel-edit">Cancel</button>'
      + '<button type="submit" class="btn btn-primary">Save</button>'
      + '</div>'
      + '</div>'
      + '</form>'
      + '</div>';

    document.body.appendChild(overlay);

    // Close on overlay background click
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });

    // Cancel button
    overlay.querySelector('#cancel-edit').addEventListener('click', function () {
      overlay.remove();
    });

    // Delete with double-click confirmation
    var deleteBtn = overlay.querySelector('#delete-task-btn');
    var deleteConfirming = false;
    deleteBtn.addEventListener('click', function () {
      if (!deleteConfirming) {
        deleteConfirming = true;
        deleteBtn.textContent = 'Confirm Delete?';
        deleteBtn.style.background = 'rgba(255, 68, 68, 0.15)';
        // Reset after 3 seconds if not confirmed
        setTimeout(function () {
          if (deleteConfirming) {
            deleteConfirming = false;
            deleteBtn.textContent = 'Delete';
            deleteBtn.style.background = '';
          }
        }, 3000);
        return;
      }
      // Confirmed -- send DELETE
      api('/tasks/' + task.id, { method: 'DELETE' })
        .then(function () { overlay.remove(); })
        .catch(function (err) {
          var errorEl = overlay.querySelector('#form-error');
          errorEl.textContent = (err.data && err.data.error) ? err.data.error : 'Failed to delete task';
          errorEl.classList.remove('hidden');
        });
    });

    // Dispatch button
    var dispatchBtn = overlay.querySelector('#dispatch-task-btn');
    dispatchBtn.addEventListener('click', function () {
      var agentSelect = overlay.querySelector('select[name="agent_id"]');
      var selectedAgent = agentSelect ? agentSelect.value : task.agent_id;
      if (!selectedAgent) {
        var errorEl = overlay.querySelector('#form-error');
        errorEl.textContent = 'Select an agent before dispatching';
        errorEl.classList.remove('hidden');
        return;
      }
      dispatchBtn.textContent = 'Dispatching...';
      dispatchBtn.disabled = true;
      api('/dispatch', { method: 'POST', body: { task_id: task.id, agent_id: selectedAgent } })
        .then(function () { overlay.remove(); })
        .catch(function (err) {
          dispatchBtn.textContent = 'Dispatch';
          dispatchBtn.disabled = false;
          var errorEl = overlay.querySelector('#form-error');
          errorEl.textContent = (err.data && err.data.error) ? err.data.error : 'Dispatch failed';
          errorEl.classList.remove('hidden');
        });
    });

    // Form submit -- save edits
    overlay.querySelector('#edit-task-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target;
      var errorEl = overlay.querySelector('#form-error');
      errorEl.classList.add('hidden');

      var body = {
        title: form.title.value.trim(),
        description: form.description.value.trim(),
        status: form.status.value,
        priority: form.priority.value,
        agent_id: form.agent_id.value || null
      };

      if (!body.title) {
        errorEl.textContent = 'Title is required';
        errorEl.classList.remove('hidden');
        return;
      }

      api('/tasks/' + task.id, { method: 'PATCH', body: body })
        .then(function () { overlay.remove(); })
        .catch(function (err) {
          errorEl.textContent = (err.data && err.data.error) ? err.data.error : 'Failed to update task';
          errorEl.classList.remove('hidden');
        });
    });

    // Focus title input
    var titleInput = overlay.querySelector('input[name="title"]');
    if (titleInput) titleInput.focus();
  }

  // --- Create Task Form ---
  function showCreateTaskForm() {
    // Remove existing overlay if present
    var existing = document.querySelector('.overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.className = 'overlay';

    // Build form content -- agent options use esc() on all dynamic values
    var agentOptions = AGENTS.map(function (a) {
      return '<option value="' + esc(a.id) + '">' + esc(a.name) + ' - ' + esc(a.role) + '</option>';
    }).join('');

    // Form HTML uses only escaped content and static strings
    overlay.innerHTML = '<div class="overlay-content">'
      + '<h2>New Task</h2>'
      + '<form id="create-task-form">'
      + '<div class="form-group">'
      + '<label>Title</label>'
      + '<input class="input" type="text" name="title" required placeholder="Task title..." />'
      + '</div>'
      + '<div class="form-group">'
      + '<label>Description</label>'
      + '<textarea class="input" name="description" rows="3" placeholder="Optional description..."></textarea>'
      + '</div>'
      + '<div class="form-group">'
      + '<label>Priority</label>'
      + '<select name="priority">'
      + '<option value="medium" selected>Medium</option>'
      + '<option value="critical">Critical</option>'
      + '<option value="high">High</option>'
      + '<option value="low">Low</option>'
      + '</select>'
      + '</div>'
      + '<div class="form-group">'
      + '<label>Assign Agent</label>'
      + '<select name="agent_id">'
      + '<option value="">Unassigned</option>'
      + agentOptions
      + '</select>'
      + '</div>'
      + '<div id="form-error" class="form-error hidden"></div>'
      + '<div class="form-actions">'
      + '<button type="button" class="btn" id="cancel-task">Cancel</button>'
      + '<button type="submit" class="btn btn-primary">Create Task</button>'
      + '</div>'
      + '</form>'
      + '</div>';

    document.body.appendChild(overlay);

    // Close on overlay background click
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });

    // Cancel button
    overlay.querySelector('#cancel-task').addEventListener('click', function () {
      overlay.remove();
    });

    // Form submit
    overlay.querySelector('#create-task-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var form = e.target;
      var errorEl = overlay.querySelector('#form-error');
      errorEl.classList.add('hidden');

      var body = {
        title: form.title.value.trim(),
        description: form.description.value.trim(),
        priority: form.priority.value,
        agent_id: form.agent_id.value || null
      };

      if (!body.title) {
        // Use textContent for plain text error messages (safe, no HTML needed)
        errorEl.textContent = 'Title is required';
        errorEl.classList.remove('hidden');
        return;
      }

      try {
        await api('/tasks', { method: 'POST', body: body });
        // Do NOT manually update state.tasks -- SSE task:created handles it
        // This proves one-way data flow: POST -> server -> SSE event -> state update -> re-render
        overlay.remove();
      } catch (err) {
        // Use textContent for error display (safe, prevents XSS from error messages)
        errorEl.textContent = (err.data && err.data.error) ? err.data.error : 'Failed to create task';
        errorEl.classList.remove('hidden');
      }
    });

    // Focus title input
    var titleInput = overlay.querySelector('input[name="title"]');
    if (titleInput) titleInput.focus();
  }

  // --- Tab Router (hash-based) ---
  var tabs = {
    '#/board': { render: renderBoard, label: 'Board' },
    '#/agents': { render: renderAgents, label: 'Agents' },
    '#/activity': { render: renderActivityView, label: 'Activity' },
    '#/inbox': { render: renderInbox, label: 'Inbox' }
  };

  function navigate() {
    var hash = location.hash || '#/board';
    var tab = tabs[hash];
    if (!tab) {
      hash = '#/board';
      tab = tabs[hash];
    }

    // Update active tab in state
    var tabName = hash.replace('#/', '');
    state.activeTab = tabName;

    // Update nav link active classes
    var navLinks = document.querySelectorAll('.nav-tab');
    navLinks.forEach(function (link) {
      if (link.getAttribute('data-tab') === tabName) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    // Render tab content
    var main = document.getElementById('main-content');
    if (main && tab) {
      main.innerHTML = '';
      tab.render(main);
    }

    // Update status bar with textContent (safe for plain text)
    var statusLeft = document.getElementById('status-left');
    if (statusLeft) {
      statusLeft.textContent = tab.label + ' view';
    }
  }

  // --- Command Bar ---
  function showCommandBar() {
    // Remove existing command bar if present
    var existing = document.querySelector('.command-bar-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.className = 'overlay command-bar-overlay';

    var bar = document.createElement('div');
    bar.className = 'command-bar';

    var input = document.createElement('input');
    input.className = 'command-input';
    input.type = 'text';
    input.placeholder = 'Type a command... (@agent message to dispatch, /board, /agents, or plain text to create task)';

    var hint = document.createElement('div');
    hint.className = 'command-hint';
    hint.innerHTML = '<kbd>@agent</kbd> dispatch &nbsp; <kbd>/route</kbd> navigate &nbsp; <kbd>text</kbd> create task &nbsp; <kbd>Esc</kbd> close';

    bar.appendChild(input);
    bar.appendChild(hint);
    overlay.appendChild(bar);
    document.body.appendChild(overlay);

    // Close on background click
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });

    // Command input keydown handler
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        overlay.remove();
        return;
      }
      if (e.key === 'Enter') {
        var value = input.value.trim();
        if (!value) {
          overlay.remove();
          return;
        }
        // Navigation commands
        if (value.charAt(0) === '/') {
          var routeMap = { '/board': '#/board', '/agents': '#/agents', '/activity': '#/activity', '/inbox': '#/inbox' };
          var route = routeMap[value.toLowerCase()];
          if (route) {
            location.hash = route;
          }
          overlay.remove();
          return;
        }
        // Agent dispatch: @agentId message -> dispatch to agent (creates task + dispatches)
        if (value.charAt(0) === '@') {
          var match = value.match(/^@(\w+)\s+(.+)$/);
          if (match) {
            var agentId = match[1];
            var message = match[2];
            hint.textContent = 'Dispatching to ' + agentId + '...';
            input.disabled = true;
            api('/dispatch', { method: 'POST', body: { agent_id: agentId, message: message } })
              .then(function () {
                overlay.remove();
              })
              .catch(function (err) {
                input.disabled = false;
                hint.textContent = (err.data && err.data.error) ? err.data.error : 'Dispatch failed';
              });
          } else {
            hint.textContent = 'Format: @agent message';
          }
          return;
        }
        // Plain text: create unassigned task
        api('/tasks', { method: 'POST', body: { title: value } })
          .then(function () { overlay.remove(); })
          .catch(function (err) {
            hint.textContent = (err.data && err.data.error) ? err.data.error : 'Failed to create task';
          });
      }
    });

    // Auto-focus input
    input.focus();
  }

  function hideCommandBar() {
    var existing = document.querySelector('.command-bar-overlay');
    if (existing) existing.remove();
  }

  function toggleCommandBar() {
    var existing = document.querySelector('.command-bar-overlay');
    if (existing) {
      existing.remove();
    } else {
      showCommandBar();
    }
  }

  // --- Keyboard Shortcuts ---
  document.addEventListener('keydown', function (e) {
    // Cmd+K / Ctrl+K: toggle command bar (works even in input fields)
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      toggleCommandBar();
      return;
    }

    // Skip if user is typing in a form field
    var tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // Skip if other modifier keys held (allow browser shortcuts)
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    var keyMap = {
      '1': '#/board',
      '2': '#/agents',
      '3': '#/activity',
      '4': '#/inbox'
    };

    if (keyMap[e.key]) {
      e.preventDefault();
      location.hash = keyMap[e.key];
    }

    if (e.key === 'Escape') {
      var overlay = document.querySelector('.overlay');
      if (overlay) overlay.remove();
    }
  });

  // --- SSE Status Indicator ---
  onChange('sseConnected', function (connected) {
    var el = document.getElementById('sse-status');
    if (!el) return;
    if (connected) {
      el.textContent = 'LIVE';
      el.className = 'badge badge-green';
    } else {
      el.textContent = 'OFFLINE';
      el.className = 'badge badge-red';
    }
  });

  // --- State Change Listeners for Re-rendering ---
  onChange('tasks', function () {
    if (state.activeTab === 'board') {
      var main = document.getElementById('main-content');
      if (main) {
        main.innerHTML = '';
        renderBoard(main);
      }
    }
  });

  onChange('activity', function () {
    if (state.activeTab === 'activity') {
      var main = document.getElementById('main-content');
      if (main) {
        main.innerHTML = '';
        renderActivityView(main);
      }
    }
  });

  onChange('agents', function () {
    if (state.activeTab === 'agents') {
      var main = document.getElementById('main-content');
      if (main) {
        main.textContent = '';
        renderAgents(main);
      }
    }
  });

  onChange('activeRuns', function () {
    if (state.activeTab === 'agents') {
      var main = document.getElementById('main-content');
      if (main) { main.innerHTML = ''; renderAgents(main); }
    }
    if (state.activeTab === 'board') {
      var main = document.getElementById('main-content');
      if (main) { main.innerHTML = ''; renderBoard(main); }
    }
  });

  // --- Initialization ---
  document.addEventListener('DOMContentLoaded', function () {
    // Load data in parallel -- catch errors gracefully (server may not be running)
    Promise.all([
      loadTasks().catch(function (err) { console.warn('Failed to load tasks:', err); }),
      loadActivity().catch(function (err) { console.warn('Failed to load activity:', err); }),
      loadAgents().catch(function (err) { console.warn('Failed to load agents:', err); })
    ]).then(function () {
      // Initial route
      navigate();
    });

    // Connect SSE for real-time updates
    connectSSE();

    // Wire hash navigation
    window.addEventListener('hashchange', navigate);

    // Status bar clock (SAST = Africa/Johannesburg, UTC+2)
    function updateClock() {
      var el = document.getElementById('status-right');
      if (el) {
        var now = new Date();
        el.textContent = now.toLocaleString('en-ZA', {
          timeZone: 'Africa/Johannesburg',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        }) + ' SAST';
      }
    }
    updateClock();
    setInterval(updateClock, 60000);
  });

})();
