/* ============================================
   Visionary Mission Control - Frontend App
   Proxy-based reactive state store, SSE,
   tab router, task board, agent cards
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

  // --- Reactive State Store (Proxy-based) ---
  var _state = {
    tasks: [],
    activity: [],
    notifications: [],
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
    return '<div class="board-card ' + priorityClass + '" draggable="true" data-action="view-task" data-task-id="' + esc(task.id) + '" style="border-left: 3px solid ' + borderColor + '">'
      + '<div class="board-card-title">' + esc(task.title) + '</div>'
      + '<div class="board-card-meta">'
      + priorityBadge(task.priority)
      + agentBadge(task.agent_id)
      + '<span class="text-muted">' + timeAgo(task.created_at) + '</span>'
      + '</div>'
      + '</div>';
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

  // Agents view: grid of 8 agent cards
  function renderAgents(container) {
    var html = '<h2 style="font-size: var(--font-size-lg); margin-bottom: var(--space-lg);">Agents</h2>'
      + '<div class="agent-grid">';

    AGENTS.forEach(function (agent) {
      var colorVar = '--agent-' + agent.id;
      html += '<div class="agent-card">'
        + '<div class="agent-name" style="color: var(' + colorVar + ')">' + esc(agent.name) + '</div>'
        + '<div class="agent-role">' + esc(agent.role) + '</div>'
        + '<span class="badge badge-green">idle</span>'
        + '</div>';
    });

    html += '</div>';
    // Agent data is hardcoded constants -- safe for innerHTML
    container.innerHTML = html;
  }

  // Activity view: list of activity entries
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
      var typeCls = 'badge-blue';
      if (entry.event_type && entry.event_type.indexOf('created') !== -1) typeCls = 'badge-green';
      if (entry.event_type && entry.event_type.indexOf('deleted') !== -1) typeCls = 'badge-red';
      if (entry.event_type && entry.event_type.indexOf('updated') !== -1) typeCls = 'badge-orange';

      html += '<div class="activity-item">'
        + '<span class="activity-time">' + esc(time) + '</span>'
        + '<span class="badge ' + typeCls + '">' + esc(entry.event_type || 'event') + '</span>'
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

  // --- Keyboard Shortcuts ---
  document.addEventListener('keydown', function (e) {
    // Skip if user is typing in a form field
    var tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // Skip if modifier keys held (allow browser shortcuts)
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

  // --- Initialization ---
  document.addEventListener('DOMContentLoaded', function () {
    // Load data in parallel -- catch errors gracefully (server may not be running)
    Promise.all([
      loadTasks().catch(function (err) { console.warn('Failed to load tasks:', err); }),
      loadActivity().catch(function (err) { console.warn('Failed to load activity:', err); })
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
