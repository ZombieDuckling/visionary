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

  // --- Markdown Renderer ---
  // Allow only safe URL schemes in markdown links; rejected URLs render as '#'.
  // Blocks javascript:, data:, vbscript:, file:, etc. — XSS via markdown.
  function safeUrl(raw) {
    if (raw == null) return '#';
    var u = String(raw).trim();
    if (!u) return '#';
    if (/^(https?:|mailto:|\/|#|\?|\.\/|\.\.\/)/i.test(u)) return u;
    if (/^[a-z][a-z0-9+.\-]*:/i.test(u)) return '#';
    return u;
  }
  function inlineFormat(text) {
    var s = esc(text);
    s = s.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_m, label, url) {
      return '<a href="' + safeUrl(url) + '" target="_blank" rel="noopener noreferrer" class="md-link">' + label + '</a>';
    });
    return s;
  }

  function renderMarkdown(raw) {
    if (!raw) return '<div class="empty-state">No content</div>';
    var lines = raw.split('\n');
    var html = '';
    var inCodeBlock = false;
    var inList = false;
    var listType = '';

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          html += '</code></pre>';
          inCodeBlock = false;
        } else {
          if (inList) { html += listType === 'ul' ? '</ul>' : '</ol>'; inList = false; }
          html += '<pre class="md-code-block"><code>';
          inCodeBlock = true;
        }
        continue;
      }
      if (inCodeBlock) {
        html += esc(line) + '\n';
        continue;
      }

      if (inList && !/^\s*[-*]\s/.test(line) && !/^\s*\d+\.\s/.test(line) && line.trim() !== '') {
        html += listType === 'ul' ? '</ul>' : '</ol>';
        inList = false;
      }

      if (line.trim() === '') {
        if (inList) { html += listType === 'ul' ? '</ul>' : '</ol>'; inList = false; }
        continue;
      }

      var headerMatch = line.match(/^(#{1,4})\s+(.+)/);
      if (headerMatch) {
        var level = headerMatch[1].length;
        html += '<h' + level + ' class="md-h' + level + '">' + inlineFormat(headerMatch[2]) + '</h' + level + '>';
        continue;
      }

      if (/^[-*_]{3,}\s*$/.test(line.trim())) {
        html += '<hr class="md-hr">';
        continue;
      }

      var ulMatch = line.match(/^\s*[-*]\s+(.+)/);
      if (ulMatch) {
        if (!inList || listType !== 'ul') {
          if (inList) html += listType === 'ul' ? '</ul>' : '</ol>';
          html += '<ul class="md-list">';
          inList = true; listType = 'ul';
        }
        html += '<li>' + inlineFormat(ulMatch[1]) + '</li>';
        continue;
      }

      var olMatch = line.match(/^\s*\d+\.\s+(.+)/);
      if (olMatch) {
        if (!inList || listType !== 'ol') {
          if (inList) html += listType === 'ul' ? '</ul>' : '</ol>';
          html += '<ol class="md-list">';
          inList = true; listType = 'ol';
        }
        html += '<li>' + inlineFormat(olMatch[1]) + '</li>';
        continue;
      }

      html += '<p class="md-p">' + inlineFormat(line) + '</p>';
    }

    if (inCodeBlock) html += '</code></pre>';
    if (inList) html += listType === 'ul' ? '</ul>' : '</ol>';
    return html;
  }

  // --- Agent Color Map ---
  var AGENT_COLORS = {
    main: '#3b8bff', jarvis: '#3b8bff', scout: '#06b6d4', analyst: '#7c5cff', forge: '#f59e0b',
    sentinel: '#ef4444', broker: '#22c55e', ops: '#8b5cf6', hunter: '#ec4899', reviewer: '#f97316',
    coder: '#d97706', researcher: '#4285f4', designer: '#e879f9', hermes: '#00ff88'
  };

  // --- Agent Emoji Map ---
  var AGENT_ICONS = {
    jarvis: '\u2699\uFE0F', scout: '\uD83D\uDD2D', analyst: '\uD83D\uDD2C', forge: '\uD83D\uDD28',
    sentinel: '\uD83D\uDEE1\uFE0F', broker: '\uD83D\uDCC8', ops: '\uD83D\uDDA5\uFE0F', hunter: '\uD83C\uDFAF', hermes: '\uD83E\uDDED'
  };

  // --- Last SSE Event Time ---
  var _lastSSEEventTime = null;

  // --- Module-level SSE source (shared so drawer can attach listeners) ---
  var _sseSource = null;

  // --- Agent Drawer State ---
  // Tracks SSE listener references so they can be removed on close.
  var _drawer = {
    agentId: null,
    listeners: []   // [{eventType, fn}, …] registered on _sseSource
  };

  // --- Org node data cache (id → node data from /api/org) ---
  // Populated each time the org chart renders so the drawer can read harness/watchdog data.
  var _orgNodeDataMap = {};

  // --- Navigation generation counter (stale-async guard) ---
  var _navGeneration = 0;

  // --- Reactive State Store (Proxy-based) ---
  var _state = {
    tasks: [],
    activity: [],
    notifications: [],
    agents: [],
    activeRuns: [],
    projects: [],
    spaces: [],
    activeTab: 'board',
    currentSpaceId: null,
    currentProjectId: null,
    collapsedSpaces: {},
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

  // --- Status Bar Updater ---
  function updateStatusBar() {
    var agentsEl = document.getElementById('status-agents');
    var tasksEl = document.getElementById('status-tasks');
    var lastEventEl = document.getElementById('status-last-event');
    if (agentsEl) agentsEl.textContent = state.agents.length || '0';
    if (tasksEl) tasksEl.textContent = state.tasks.length || '0';
    if (lastEventEl && _lastSSEEventTime) {
      lastEventEl.textContent = timeAgo(_lastSSEEventTime);
    }
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
    var data = await api('/tasks');
    state.tasks = data.tasks || data || [];
  }

  async function loadActivity() {
    var data = await api('/activity');
    state.activity = data.activity || data || [];
  }

  async function loadAgents() {
    var data = await api('/agents');
    state.agents = data.agents || [];
  }

  async function loadNotifications() {
    var data = await api('/notifications');
    state.notifications = data.notifications || [];
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

    // Helper to track last event time
    function markEvent() {
      _lastSSEEventTime = new Date().toISOString();
      updateStatusBar();
    }

    source.addEventListener('task:created', function (e) {
      markEvent();
      var task = JSON.parse(e.data);
      state.tasks = [].concat(state.tasks, [task]);
    });

    source.addEventListener('task:updated', function (e) {
      markEvent();
      var updated = JSON.parse(e.data);
      state.tasks = state.tasks.map(function (t) {
        return t.id === updated.id ? updated : t;
      });
    });

    source.addEventListener('task:deleted', function (e) {
      markEvent();
      var deleted = JSON.parse(e.data);
      state.tasks = state.tasks.filter(function (t) {
        return t.id !== deleted.id;
      });
    });

    source.addEventListener('activity:new', function (e) {
      markEvent();
      var entry = JSON.parse(e.data);
      state.activity = [entry].concat(state.activity).slice(0, 100);
    });

    source.addEventListener('agent:status', function (e) {
      markEvent();
      var updated = JSON.parse(e.data);
      state.agents = state.agents.map(function (a) {
        return a.id === updated.id ? Object.assign({}, a, updated) : a;
      });
    });

    // --- Agent dispatch SSE events ---

    source.addEventListener('agent:started', function (e) {
      markEvent();
      var d = JSON.parse(e.data);
      state.activeRuns = [].concat(state.activeRuns, [{
        run_id: d.run_id, agent_id: d.agent_id, task_id: d.task_id, elapsed_ms: 0
      }]);
      loadAgents().catch(function () {});
    });

    source.addEventListener('agent:completed', function (e) {
      markEvent();
      var d = JSON.parse(e.data);
      state.activeRuns = state.activeRuns.filter(function (r) {
        return r.run_id !== d.run_id;
      });
      loadAgents().catch(function () {});
    });

    source.addEventListener('agent:failed', function (e) {
      markEvent();
      var d = JSON.parse(e.data);
      state.activeRuns = state.activeRuns.filter(function (r) {
        return r.run_id !== d.run_id;
      });
      loadAgents().catch(function () {});
    });

    source.addEventListener('agent:progress', function (e) {
      markEvent();
      var d = JSON.parse(e.data);
      state.activeRuns = state.activeRuns.map(function (r) {
        if (r.run_id === d.run_id) {
          return Object.assign({}, r, { elapsed_ms: d.elapsed_ms });
        }
        return r;
      });
    });

    source.addEventListener('notification:created', function (e) {
      markEvent();
      var n = JSON.parse(e.data);
      state.notifications = [n].concat(state.notifications);
    });

    source.addEventListener('notification:updated', function (e) {
      markEvent();
      loadNotifications().catch(function () {});
    });

    _sseSource = source;
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
    { id: 'hunter', name: 'Hunter', role: 'Job hunting' },
    { id: 'hermes', name: 'Hermes', role: 'Persistent orchestrator' }
  ];

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
    var priorityModifier = task.priority ? 'priority-' + esc(task.priority) : '';
    var borderColor = STATUS_BORDER_COLOR[task.status] || 'var(--text-muted)';

    var isRunning = false;
    for (var r = 0; r < state.activeRuns.length; r++) {
      if (state.activeRuns[r].task_id === task.id) { isRunning = true; break; }
    }

    var html = '<div class="board-card ' + priorityModifier + '" draggable="true" data-action="view-task" data-task-id="' + esc(task.id) + '" style="border-left: 3px solid ' + esc(borderColor) + '">'
      + '<div class="board-card-title">' + esc(task.title) + '</div>'
      + '<div class="board-card-meta">'
      + '<span class="badge ' + priorityClass(task.priority) + '">' + esc(task.priority || 'medium') + '</span>'
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

  // Overview view: mission control snapshot for deciding what to do next
  function renderOverview(container) {
    var requestId = Date.now() + ':' + Math.random().toString(36).slice(2);
    container._viewRequestId = requestId;
    container.innerHTML = '<h2 class="section-header"><span class="section-header-icon">⌁</span> Mission Overview</h2>'
      + '<div class="overview-loading card">Loading live project state...</div>';

    api('/overview').then(function (data) {
      if (container._viewRequestId !== requestId || state.activeTab !== 'overview') return;
      var counts = data.counts || {};
      var tasks = counts.tasks || {};
      var runs = counts.runs || {};
      var projects = counts.projects || {};
      var openTasks = data.open_tasks || [];
      var staleRuns = data.stale_running_runs || [];
      var recentRuns = data.recent_runs || [];
      var activity = data.recent_activity || [];
      var missions = data.missions || [];
      var orchestrator = data.orchestrator || null;
      var healthLabel = staleRuns.length ? 'Needs attention' : 'Ready';

      var html = '<h2 class="section-header"><span class="section-header-icon">⌁</span> Mission Overview</h2>';
      html += '<div class="overview-hero card">'
        + '<div><div class="overview-kicker">Daily command center</div>'
        + '<div class="overview-title">' + esc(healthLabel) + '</div>'
        + '<div class="overview-subtitle">' + esc(openTasks.length ? 'Next useful work is waiting on the board.' : 'No open dashboard tasks. Create or dispatch the next mission.') + '</div></div>'
        + '<div class="overview-actions"><a class="btn btn-primary" href="#/board">Open board</a><button class="btn" data-action="open-command-bar">Dispatch Cmd+K</button></div>'
        + '</div>';

      html += '<section class="card overview-panel overview-missions"><div class="overview-panel-header"><h3>Today\'s top 3 missions</h3><span class="badge badge-blue">auto-ranked</span></div>';
      if (!missions.length) {
        html += '<div class="empty-state compact"><div class="empty-state-title">No missions ranked yet</div><div class="empty-state-desc">Overview could not derive missions from the current state.</div></div>';
      } else {
        html += '<div class="mission-list">';
        missions.forEach(function (m) {
          html += '<div class="mission-card">'
            + '<div class="mission-rank">#' + esc(m.rank || '') + '</div>'
            + '<div class="mission-body"><div class="mission-title">' + esc(m.title) + '</div><div class="overview-meta">' + esc(m.detail || '') + '</div></div>'
            + '<span class="badge ' + priorityClass(m.priority) + '">' + esc(m.priority || 'medium') + '</span>'
            + '<button class="btn btn-small" data-action="mission-action" data-mission-action="' + esc(m.action_type || '') + '" data-target="' + esc(m.target || '') + '" data-task-id="' + esc(m.task_id || '') + '" data-agent-id="' + esc(m.agent_id || '') + '">' + esc(m.action_label || 'Open') + '</button>'
            + '</div>';
        });
        html += '</div>';
      }
      html += '</section>';

      if (orchestrator) {
        html += renderOrchestratorPanel(orchestrator);
      }

      html += '<div class="overview-metrics">'
        + overviewMetric('Open tasks', (tasks.todo || 0) + (tasks.in_progress || 0) + (tasks.review || 0), 'todo ' + (tasks.todo || 0) + ' · active ' + (tasks.in_progress || 0) + ' · review ' + (tasks.review || 0))
        + overviewMetric('Done', tasks.done || 0, 'completed tasks')
        + overviewMetric('Agents running', counts.active_dispatches || 0, 'db running ' + (runs.running || 0))
        + overviewMetric('Projects', projects.active || 0, 'active')
        + overviewMetric('Unread', counts.unread_notifications || 0, 'notifications')
        + '</div>';

      if (staleRuns.length) {
        html += '<div class="overview-alert card"><span class="badge badge-orange">Stale running rows</span><span>' + staleRuns.length + ' agent run(s) have been marked running for more than 2 hours. They may be leftovers from previous sessions.</span><button class="btn btn-danger" data-action="clean-stale-runs">Clean stale runs</button></div>';
      }

      html += '<div class="overview-grid">';
      html += '<section class="card overview-panel"><h3>Next tasks</h3>';
      if (!openTasks.length) {
        html += '<div class="empty-state compact"><div class="empty-state-title">No open tasks</div><div class="empty-state-desc">Use Cmd+K to create or dispatch the next mission.</div></div>';
      } else {
        html += '<div class="overview-list">';
        openTasks.forEach(function (t) {
          html += '<div class="overview-list-item">'
            + '<div><strong>' + esc(t.title) + '</strong><div class="overview-meta">' + esc(t.project_name || 'No project') + ' · ' + esc(t.agent_id || 'unassigned') + '</div></div>'
            + '<span class="badge ' + priorityClass(t.priority) + '">' + esc(t.priority || 'medium') + '</span>'
            + '</div>';
        });
        html += '</div>';
      }
      html += '</section>';

      html += '<section class="card overview-panel"><h3>Recent agent runs</h3>';
      if (!recentRuns.length) { html += '<div class="empty-state compact"><div class="empty-state-title">No runs yet</div></div>'; }
      else {
        html += '<div class="overview-list">';
        recentRuns.forEach(function (r) {
          html += '<div class="overview-list-item">'
            + '<div><strong>' + esc(r.agent_id) + '</strong><div class="overview-meta">' + esc(r.task_title || r.message || 'Manual run') + '</div></div>'
            + '<span class="badge ' + runBadge(r.status) + '">' + esc(r.status) + '</span>'
            + '</div>';
        });
        html += '</div>';
      }
      html += '</section>';

      html += '<section class="card overview-panel wide"><h3>Recent activity</h3>';
      if (!activity.length) { html += '<div class="empty-state compact"><div class="empty-state-title">No activity yet</div></div>'; }
      else {
        html += '<div class="overview-activity">';
        activity.forEach(function (a) {
          html += '<div class="overview-activity-row"><span class="overview-dot"></span><div><strong>' + esc(a.event_type) + '</strong><div>' + esc(a.summary) + '</div><small>' + esc(timeAgo(a.created_at)) + '</small></div></div>';
        });
        html += '</div>';
      }
      html += '</section></div>';

      container.innerHTML = html;
    }).catch(function (err) {
      if (container._viewRequestId !== requestId || state.activeTab !== 'overview') return;
      container.innerHTML = '<h2 class="section-header"><span class="section-header-icon">⌁</span> Mission Overview</h2>'
        + '<div class="card overview-alert"><span class="badge badge-red">Error</span><span>' + esc((err.data && err.data.error) || err.message || 'Failed to load overview') + '</span></div>';
    });
  }

  function renderOrchestratorPanel(orchestrator) {
    var workers = orchestrator.workers || [];
    var gateway = orchestrator.gateway || {};
    var cron = orchestrator.cron || {};
    var running = workers.filter(function (w) { return w.tmux === 'running'; }).length;
    var gatewayBadge = gateway.running ? 'badge-green' : 'badge-red';
    var gatewayLabel = gateway.running ? ('gateway live' + (gateway.pid ? ' #' + gateway.pid : '')) : 'gateway off';
    var cronLabel = cron.state || 'scheduled';
    var html = '<section class="card overview-panel overview-orchestrator">'
      + '<div class="overview-panel-header"><h3>Hermes persistent orchestrator</h3><span class="badge ' + gatewayBadge + '">' + esc(gatewayLabel) + '</span></div>'
      + '<div class="overview-meta">Cron ' + esc(cron.schedule || 'every 30m') + ' · ' + esc(cronLabel) + ' · workers ' + running + '/' + workers.length + ' running · updated ' + esc(timeAgo(orchestrator.updated_at)) + '</div>'
      + '<div class="orchestrator-health">'
      + '<div><span class="overview-metric-label">Gateway</span><strong>' + esc(gateway.status || 'unknown') + '</strong></div>'
      + '<div><span class="overview-metric-label">Cron job</span><strong>' + esc(cron.job_id || 'unknown') + '</strong></div>'
      + '<div><span class="overview-metric-label">Watchdog</span><strong>' + esc(orchestrator.watchdog_path ? 'installed' : 'missing') + '</strong></div>'
      + '</div>'
      + '<div class="orchestrator-workers">';
    workers.forEach(function (w) {
      html += '<div class="orchestrator-worker"><div><strong>' + esc(w.lane) + '</strong><div class="overview-meta">' + esc(w.status) + ' · tmux ' + esc(w.tmux) + '</div></div><span class="badge ' + (w.tmux === 'running' ? 'badge-green' : 'badge-orange') + '">' + esc(w.tmux) + '</span></div>';
    });
    html += '</div>'
      + '<div class="overview-actions"><a class="btn" href="#/agents">View agents</a><a class="btn" href="#/activity">Activity</a><button class="btn" data-action="open-command-bar">Dispatch Hermes</button></div>'
      + '</section>';
    return html;
  }

  function overviewMetric(label, value, detail) {
    return '<div class="card overview-metric"><div class="overview-metric-label">' + esc(label) + '</div><div class="overview-metric-value">' + esc(value) + '</div><div class="overview-metric-detail">' + esc(detail) + '</div></div>';
  }

  function priorityClass(priority) {
    if (priority === 'critical') return 'badge-red';
    if (priority === 'high') return 'badge-orange';
    if (priority === 'low') return 'badge-blue';
    return 'badge-green';
  }

  function runBadge(status) {
    if (status === 'completed') return 'badge-green';
    if (status === 'running') return 'badge-blue';
    if (status === 'failed' || status === 'timeout') return 'badge-red';
    return 'badge-orange';
  }

  // Board view: 4-column grid grouped by status
  function renderBoard(container) {
    var statuses = ['todo', 'in_progress', 'review', 'done'];
    var labels = { todo: 'To Do', in_progress: 'In Progress', review: 'Review', done: 'Done' };
    var grouped = {};
    statuses.forEach(function (s) { grouped[s] = []; });

    // Scope tasks by current project when one is selected
    var scoped = state.tasks;
    if (state.currentProjectId) {
      scoped = state.tasks.filter(function (t) {
        return String(t.project_id) === String(state.currentProjectId);
      });
    }
    scoped.forEach(function (t) {
      var s = t.status || 'todo';
      if (grouped[s]) {
        grouped[s].push(t);
      } else {
        grouped.todo.push(t);
      }
    });

    // Resolve project + space for the breadcrumb
    var project = null;
    var space = null;
    if (state.currentProjectId) {
      project = (state.projects || []).find(function (p) {
        return String(p.id) === String(state.currentProjectId);
      });
    }
    if (project) {
      space = (state.spaces || []).find(function (s) { return s.id === project.space_id; });
    }
    var crumb = '';
    if (project) {
      crumb = '<div class="board-crumb">'
        + (space ? '<span class="board-crumb-space" style="--space-color: ' + esc(space.color || '#FF2EC4') + '">' + esc(space.name) + '</span><span class="board-crumb-sep">/</span>' : '')
        + '<span class="board-crumb-project" style="--project-color: ' + esc(project.color || '#00F0FF') + '">' + esc(project.name) + '</span>'
        + '</div>';
    } else {
      crumb = '<div class="board-crumb"><span class="board-crumb-all">All tasks (no project selected)</span></div>';
    }

    var html = '<div class="board-header">'
      + '<div>'
      + '<h2 class="section-header"><span class="section-header-icon">\uD83D\uDCCB</span> Task Board</h2>'
      + crumb
      + '</div>'
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
      if (tasks.length === 0) {
        html += '<div class="board-column-empty">Drop tasks here</div>';
      }
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
  // ============================================================
  //  Agent Drawer \u2014 slide-out panel for per-agent detail + SSE
  // ============================================================

  // Close the drawer and release all SSE listeners registered for it.
  function closeAgentDrawer() {
    // Remove SSE listeners added for this drawer session
    _drawer.listeners.forEach(function (entry) {
      if (entry.eventType === '_keydown_cleanup') {
        // synthetic entry: call fn directly to remove the document keydown handler
        entry.fn();
      } else if (_sseSource) {
        _sseSource.removeEventListener(entry.eventType, entry.fn);
      }
    });
    _drawer.listeners = [];
    _drawer.agentId = null;

    var el = document.getElementById('agent-drawer');
    if (el) el.remove();
    var backdrop = document.getElementById('agent-drawer-backdrop');
    if (backdrop) backdrop.remove();
  }

  // Register a drawer SSE listener that will be cleaned up on close.
  function drawerSSEListen(eventType, fn) {
    if (!_sseSource) return;
    _sseSource.addEventListener(eventType, fn);
    _drawer.listeners.push({ eventType: eventType, fn: fn });
  }

  // Append a message bubble to the drawer stream area.
  function drawerAppendMessage(streamEl, role, content, harness, ts) {
    var bubble = document.createElement('div');
    bubble.className = 'drawer-msg drawer-msg-' + (role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'system');
    var meta = '';
    if (harness) meta += '<span class="drawer-msg-harness">' + esc(harness) + '</span>';
    if (ts) meta += '<span class="drawer-msg-ts">' + timeAgo(ts) + '</span>';
    bubble.innerHTML = (meta ? '<div class="drawer-msg-meta">' + meta + '</div>' : '')
      + '<div class="drawer-msg-body">' + renderMarkdown(content) + '</div>';
    streamEl.insertBefore(bubble, streamEl.firstChild);
  }

  // Open the drawer for a given agent node.
  function openAgentDrawer(agentId, nodeData) {
    // Close any existing drawer first (handles switching agents)
    closeAgentDrawer();

    _drawer.agentId = agentId;

    // --- Backdrop ---
    var backdrop = document.createElement('div');
    backdrop.id = 'agent-drawer-backdrop';
    backdrop.className = 'agent-drawer-backdrop';
    backdrop.addEventListener('click', closeAgentDrawer);
    document.body.appendChild(backdrop);

    // --- Drawer shell ---
    var drawer = document.createElement('div');
    drawer.id = 'agent-drawer';
    drawer.className = 'agent-drawer';
    drawer.setAttribute('role', 'complementary');
    drawer.setAttribute('aria-label', 'Agent detail panel');

    // Resolve display info
    var agentObj = (state.agents || []).find(function (a) { return a.id === agentId; })
      || AGENTS.find(function (a) { return a.id === agentId; })
      || { id: agentId, name: agentId };
    var agentColor = agentObj.color || AGENT_COLORS[agentId] || '#00F0FF';
    var icon = agentObj.icon || AGENT_ICONS[agentId] || '';
    var agentName = agentObj.name || agentId;
    var nd = nodeData || {};
    var healthStatus = nd.health_status || agentObj.health_status || 'unknown';
    var healthCls = 'health-' + healthStatus;
    var model = (agentObj.model || '').replace(/-\d{8}$/, '');
    var runtime = agentObj.runtime || '';
    var chain = (nd.harness_chain || []).map(function (h) {
      var active = h === nd.current_harness;
      return '<span class="org-harness' + (active ? ' active' : '') + '">' + esc(h) + '</span>';
    }).join('');
    var watchdogInfo = nd.watchdog_config
      ? '<span class="drawer-meta-val">' + esc(JSON.stringify(nd.watchdog_config)) + '</span>'
      : '<span class="drawer-meta-val drawer-meta-none">none</span>';

    drawer.innerHTML = ''
      + '<div class="drawer-header" style="--drawer-color: ' + esc(agentColor) + '">'
      +   '<div class="drawer-title-row">'
      +     '<span class="org-led ' + esc(healthCls) + '"></span>'
      +     (icon ? '<span class="drawer-icon">' + esc(icon) + '</span>' : '')
      +     '<span class="drawer-agent-name">' + esc(agentName) + '</span>'
      +     '<button class="drawer-close" id="drawer-close-btn" aria-label="Close drawer">\u2715</button>'
      +   '</div>'
      +   '<div class="drawer-meta-grid">'
      +     (model    ? '<span class="drawer-meta-key">Model</span><span class="drawer-meta-val">' + esc(model) + '</span>' : '')
      +     (runtime  ? '<span class="drawer-meta-key">Runtime</span><span class="drawer-meta-val">' + esc(runtime) + '</span>' : '')
      +     '<span class="drawer-meta-key">Health</span><span class="drawer-meta-val drawer-health-' + esc(healthStatus) + '">' + esc(healthStatus) + '</span>'
      +     (chain    ? '<span class="drawer-meta-key">Harness</span><div class="org-harness-chain drawer-harness-chain">' + chain + '</div>' : '')
      +     '<span class="drawer-meta-key">Watchdog</span>' + watchdogInfo
      +   '</div>'
      + '</div>'
      + '<div class="drawer-section-label">DISPATCH</div>'
      + '<div class="drawer-dispatch-area">'
      +   '<textarea class="drawer-dispatch-input" id="drawer-dispatch-input" rows="3" placeholder="Message ' + esc(agentName) + '\u2026"></textarea>'
      +   '<div class="drawer-dispatch-row">'
      +     '<div id="drawer-dispatch-error" class="drawer-dispatch-error hidden"></div>'
      +     '<button class="btn btn-primary drawer-dispatch-btn" id="drawer-dispatch-btn">\u25B6 Dispatch</button>'
      +   '</div>'
      + '</div>'
      + '<div class="drawer-section-label">LIVE STREAM <span id="drawer-stream-indicator" class="drawer-stream-dot hidden"></span></div>'
      + '<div class="drawer-stream" id="drawer-stream"><div class="drawer-stream-empty">Dispatch to see live output here.</div></div>'
      + '<div class="drawer-section-label">RECENT MESSAGES</div>'
      + '<div class="drawer-messages" id="drawer-messages"><div class="overview-loading">Loading\u2026</div></div>';

    document.body.appendChild(drawer);

    // Trigger CSS transition on next frame
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        drawer.classList.add('open');
        backdrop.classList.add('open');
      });
    });

    // --- Close button ---
    drawer.querySelector('#drawer-close-btn').addEventListener('click', closeAgentDrawer);

    // --- Keyboard ESC ---
    function onKeydown(e) {
      if (e.key === 'Escape') { closeAgentDrawer(); document.removeEventListener('keydown', onKeydown); }
    }
    document.addEventListener('keydown', onKeydown);
    // Store cleanup ref for keydown
    _drawer.listeners.push({ eventType: '_keydown_cleanup', fn: function () { document.removeEventListener('keydown', onKeydown); } });

    // --- Load recent messages ---
    var messagesEl = drawer.querySelector('#drawer-messages');
    api('/agents/' + encodeURIComponent(agentId) + '/messages?limit=20').then(function (data) {
      var msgs = data.messages || [];
      if (!messagesEl.isConnected) return;
      if (!msgs.length) {
        messagesEl.innerHTML = '<div class="drawer-stream-empty">No messages yet.</div>';
        return;
      }
      messagesEl.innerHTML = '';
      msgs.forEach(function (m) {
        drawerAppendMessage(messagesEl, m.role, m.content, m.harness, m.created_at);
      });
    }).catch(function () {
      if (messagesEl.isConnected) messagesEl.innerHTML = '<div class="drawer-stream-empty">Failed to load messages.</div>';
    });

    // --- Dispatch handler ---
    var dispatchBtn = drawer.querySelector('#drawer-dispatch-btn');
    var dispatchInput = drawer.querySelector('#drawer-dispatch-input');
    var dispatchError = drawer.querySelector('#drawer-dispatch-error');
    var streamEl = drawer.querySelector('#drawer-stream');
    var streamIndicator = drawer.querySelector('#drawer-stream-indicator');

    // SSE filter strategy: CLIENT-SIDE filtering.
    // We listen to the existing /api/events stream (_sseSource) and filter events
    // where d.agent_id === _drawer.agentId. This avoids any server changes and
    // works because every agent:started/completed/failed/progress event carries agent_id.
    function attachDrawerSSE() {
      function handleAgentEvent(e) {
        var d;
        try { d = JSON.parse(e.data); } catch (err) { return; }
        if (d.agent_id !== _drawer.agentId) return;

        streamIndicator.classList.remove('hidden');

        var eventType = e.type;
        if (eventType === 'agent:started') {
          var startBubble = document.createElement('div');
          startBubble.className = 'drawer-stream-event drawer-stream-started';
          startBubble.textContent = '\u25CF Run started \u00B7 ' + timeAgo(new Date().toISOString());
          streamEl.innerHTML = '';
          streamEl.appendChild(startBubble);
        } else if (eventType === 'agent:progress') {
          // Update elapsed time display in a progress bubble
          var existing = streamEl.querySelector('.drawer-stream-progress');
          if (!existing) {
            existing = document.createElement('div');
            existing.className = 'drawer-stream-event drawer-stream-progress';
            streamEl.appendChild(existing);
          }
          existing.textContent = '\u25B6 Running \u00B7 ' + formatElapsed(d.elapsed_ms || 0);
        } else if (eventType === 'agent:completed') {
          streamIndicator.classList.add('hidden');
          var doneBubble = document.createElement('div');
          doneBubble.className = 'drawer-stream-event drawer-stream-done';
          doneBubble.textContent = '\u2713 Completed';
          streamEl.appendChild(doneBubble);
          // Reload messages to show the new assistant turn
          api('/agents/' + encodeURIComponent(_drawer.agentId) + '/messages?limit=20').then(function (data) {
            var msgs = data.messages || [];
            if (!messagesEl.isConnected) return;
            messagesEl.innerHTML = '';
            msgs.forEach(function (m) {
              drawerAppendMessage(messagesEl, m.role, m.content, m.harness, m.created_at);
            });
          }).catch(function () {});
        } else if (eventType === 'agent:failed') {
          streamIndicator.classList.add('hidden');
          var failBubble = document.createElement('div');
          failBubble.className = 'drawer-stream-event drawer-stream-fail';
          failBubble.textContent = '\u2715 Failed' + (d.error ? ': ' + d.error : '');
          streamEl.appendChild(failBubble);
        } else if (eventType === 'agent:harness') {
          // Which harness is currently running (and the failover position).
          var hb = streamEl.querySelector('.drawer-stream-harness');
          if (!hb) {
            hb = document.createElement('div');
            hb.className = 'drawer-stream-event drawer-stream-harness';
            streamEl.appendChild(hb);
          }
          hb.textContent = '\u2699 ' + (d.harness || '?') + ' \u00b7 attempt ' + (d.attempt || 1) + '/' + (d.total || 1);
        } else if (eventType === 'agent:output') {
          // Live token/line stream from the running harness.
          var live = streamEl.querySelector('.drawer-stream-live');
          if (!live) {
            live = document.createElement('pre');
            live.className = 'drawer-stream-live';
            streamEl.appendChild(live);
          }
          live.textContent += (d.chunk || '');
          // Keep the live buffer bounded so a chatty agent can't grow the DOM forever.
          if (live.textContent.length > 20000) live.textContent = live.textContent.slice(-20000);
          live.scrollTop = live.scrollHeight;
        }
      }

      drawerSSEListen('agent:started',   handleAgentEvent);
      drawerSSEListen('agent:progress',  handleAgentEvent);
      drawerSSEListen('agent:harness',   handleAgentEvent);
      drawerSSEListen('agent:output',    handleAgentEvent);
      drawerSSEListen('agent:completed', handleAgentEvent);
      drawerSSEListen('agent:failed',    handleAgentEvent);
    }

    attachDrawerSSE();

    dispatchBtn.addEventListener('click', function () {
      var message = dispatchInput.value.trim();
      if (!message) {
        dispatchError.textContent = 'Message is required';
        dispatchError.classList.remove('hidden');
        return;
      }
      dispatchError.classList.add('hidden');
      dispatchBtn.disabled = true;
      dispatchBtn.textContent = 'Dispatching\u2026';

      streamEl.innerHTML = '<div class="drawer-stream-event drawer-stream-queued">\u23F3 Queuing dispatch\u2026</div>';
      streamIndicator.classList.remove('hidden');

      api('/dispatch', { method: 'POST', body: { agent_id: agentId, message: message } })
        .then(function () {
          dispatchInput.value = '';
          dispatchBtn.disabled = false;
          dispatchBtn.textContent = '\u25B6 Dispatch';
          showToast('Dispatched to ' + agentName);
        })
        .catch(function (err) {
          dispatchBtn.disabled = false;
          dispatchBtn.textContent = '\u25B6 Dispatch';
          streamIndicator.classList.add('hidden');
          var msg = (err.data && err.data.error) ? err.data.error : 'Dispatch failed';
          dispatchError.textContent = msg;
          dispatchError.classList.remove('hidden');
          streamEl.innerHTML = '<div class="drawer-stream-event drawer-stream-fail">\u2715 ' + esc(msg) + '</div>';
        });
    });

    // Focus textarea for quick typing
    dispatchInput.focus();
  }

  function renderAgents(container) {
    container.innerHTML = '<h2 class="section-header"><span class="section-header-icon">\uD83C\uDFD9</span> Org Chart</h2>'
      + '<div id="org-chart-mount" class="org-chart"><div class="overview-loading">Loading org chart...</div></div>';

    // Event delegation for dispatch + kill + drawer on the org tree
    container.addEventListener('click', function (e) {
      var killBtn = e.target.closest('[data-action="kill-agent"]');
      if (killBtn) {
        var runId = killBtn.getAttribute('data-run-id');
        killBtn.textContent = 'Killing...';
        killBtn.disabled = true;
        api('/dispatch/' + runId + '/kill', { method: 'POST' })
          .catch(function (err) { console.warn('Kill failed:', err); });
        return;
      }
      var dispatchBtn = e.target.closest('[data-action="dispatch-agent"]');
      if (dispatchBtn) {
        var agentId = dispatchBtn.getAttribute('data-agent-id');
        // Open drawer instead of the old overlay form — drawer has inline dispatch
        var node = dispatchBtn.closest('.org-node');
        openAgentDrawer(agentId, node ? _orgNodeDataMap[agentId] : null);
        return;
      }
      // Clicking any part of a node (except action buttons) opens the drawer
      var orgNode = e.target.closest('.org-node');
      if (orgNode && !e.target.closest('.org-node-actions')) {
        var nodeAgentId = orgNode.getAttribute('data-agent-id');
        if (nodeAgentId) openAgentDrawer(nodeAgentId, _orgNodeDataMap[nodeAgentId] || null);
      }
    });

    // Hydrate org chart asynchronously
    loadAndRenderOrgChart(container);
  }

  function loadAndRenderOrgChart(container) {
    var mount = container.querySelector('#org-chart-mount');
    if (!mount) return;
    api('/org').then(function (data) {
      if (!mount.isConnected) return;
      mount.innerHTML = renderOrgChartHTML(data);
    }).catch(function (err) {
      if (!mount.isConnected) return;
      mount.innerHTML = '<div class="empty-state"><div class="empty-state-title">Org chart unavailable</div><div class="empty-state-desc">' + esc(err.message || 'fetch failed') + '</div></div>';
    });
  }

  function indexOrgNodes(node) {
    if (!node || !node.id) return;
    _orgNodeDataMap[node.id] = node;
    if (node.reports && node.reports.length) {
      node.reports.forEach(indexOrgNodes);
    }
  }

  function renderOrgChartHTML(data) {
    if (!data || !data.ceo) {
      return '<div class="empty-state"><div class="empty-state-title">No org chart configured</div><div class="empty-state-desc">Edit personalities/org-chart.json and restart the server.</div></div>';
    }
    // Rebuild node data cache for the drawer
    _orgNodeDataMap = {};
    indexOrgNodes(data.ceo);
    (data.orphans || []).forEach(indexOrgNodes);

    // Build an index of agent operational state by id (status, model, icon, etc.)
    var agentsById = {};
    var sourceAgents = (state.agents && state.agents.length) ? state.agents : AGENTS;
    sourceAgents.forEach(function (a) { agentsById[a.id] = a; });
    var activeRunsById = {};
    (state.activeRuns || []).forEach(function (r) { activeRunsById[r.agent_id] = r; });
    return '<div class="org-tree">' + renderOrgNode(data.ceo, 0, agentsById, activeRunsById) + '</div>';
  }

  function renderOrgNode(node, depth, agentsById, activeRunsById) {
    var liveAgent = agentsById[node.id] || {};
    var activeRun = activeRunsById[node.id] || null;
    var icon = liveAgent.icon || AGENT_ICONS[node.id] || '';
    var color = liveAgent.color || AGENT_COLORS[node.id] || '#00F0FF';
    var model = liveAgent.model ? liveAgent.model.replace(/-\d{8}$/, '') : '';
    var summary = liveAgent.last_run_summary ? liveAgent.last_run_summary.substring(0, 100) : '';
    var statusClass = 'health-' + (node.health_status || 'unknown');
    var lastActivity = node.last_activity_at ? timeAgo(node.last_activity_at) : 'no activity';
    var lastCheck = node.last_health_check ? timeAgo(node.last_health_check) : 'never';
    var chain = (node.harness_chain || []).map(function (h) {
      var active = h === node.current_harness;
      return '<span class="org-harness' + (active ? ' active' : '') + '">' + esc(h) + '</span>';
    }).join('');

    var html = '<div class="org-node org-role-' + esc(node.role || 'ic') + ' ' + statusClass + '" data-depth="' + depth + '" data-agent-id="' + esc(node.id) + '" style="--node-color: ' + esc(color) + '; cursor: pointer;">'
      + '<div class="org-node-head">'
      + '<span class="org-led"></span>'
      + (icon ? '<span class="org-icon">' + esc(icon) + '</span>' : '')
      + '<span class="org-name">' + esc(node.name) + '</span>'
      + (node.title ? '<span class="org-title">' + esc(node.title) + '</span>' : '')
      + '<span class="org-role-pill">' + esc((node.role || 'ic').toUpperCase()) + '</span>'
      + '<div class="org-node-actions">'
      + (activeRun
        ? '<button class="btn btn-small btn-danger" data-action="kill-agent" data-run-id="' + esc(activeRun.run_id) + '">Kill</button>'
        : '<button class="btn btn-small btn-dispatch" data-action="dispatch-agent" data-agent-id="' + esc(node.id) + '">\u25B6 Dispatch</button>'
        )
      + '</div>'
      + '</div>'
      + (model ? '<div class="org-node-model">' + esc(model) + '</div>' : '')
      + (summary ? '<div class="org-node-summary">' + esc(summary) + '</div>' : '')
      + '<div class="org-node-meta">'
      + '<div class="org-harness-chain">' + chain + '</div>'
      + '<div class="org-stats">'
      + '<span>act ' + esc(lastActivity) + '</span>'
      + '<span>chk ' + esc(lastCheck) + '</span>'
      + (activeRun ? '<span class="org-running">\u25CF running ' + esc(formatElapsed(activeRun.elapsed_ms)) + '</span>' : '')
      + '</div>'
      + '</div>'
      + '</div>';

    if (node.reports && node.reports.length) {
      html += '<div class="org-children">' + node.reports.map(function (child) { return renderOrgNode(child, depth + 1, agentsById, activeRunsById); }).join('') + '</div>';
    }
    return html;
  }

  // Agent dispatch quick form
  function showAgentDispatchForm(agentId) {
    var existing = document.querySelector('.overlay');
    if (existing) existing.remove();

    var agentColor = AGENT_COLORS[agentId] || '#888';
    var icon = AGENT_ICONS[agentId] || '';
    var agentObj = AGENTS.find(function (a) { return a.id === agentId; });
    var agentName = agentObj ? agentObj.name : agentId;

    var overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = '<div class="overlay-content">'
      + '<h2 style="color: ' + agentColor + '">' + esc(icon) + ' Dispatch ' + esc(agentName) + '</h2>'
      + '<form id="agent-dispatch-form">'
      + '<div class="form-group">'
      + '<label>Message / Task Description</label>'
      + '<textarea class="input" name="message" rows="4" placeholder="What should ' + esc(agentName) + ' do?" required></textarea>'
      + '</div>'
      + '<div id="form-error" class="form-error hidden"></div>'
      + '<div class="form-actions">'
      + '<button type="button" class="btn" id="cancel-dispatch">Cancel</button>'
      + '<button type="submit" class="btn btn-primary">\u25B6 Dispatch</button>'
      + '</div></form></div>';

    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#cancel-dispatch').addEventListener('click', function () { overlay.remove(); });

    overlay.querySelector('#agent-dispatch-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var form = e.target;
      var errorEl = overlay.querySelector('#form-error');
      errorEl.classList.add('hidden');
      var message = form.message.value.trim();
      if (!message) { errorEl.textContent = 'Message is required'; errorEl.classList.remove('hidden'); return; }
      try {
        await api('/dispatch', { method: 'POST', body: { agent_id: agentId, message: message } });
        overlay.remove();
        showToast('Dispatched to ' + agentName);
      } catch (err) {
        errorEl.textContent = (err.data && err.data.error) ? err.data.error : 'Dispatch failed';
        errorEl.classList.remove('hidden');
      }
    });

    overlay.querySelector('textarea[name="message"]').focus();
  }

  // Activity view: list of activity entries with agent-colored borders
  function renderActivityView(container) {
    var html = '<h2 class="section-header"><span class="section-header-icon">\u26A1</span> Activity</h2>';

    if (state.activity.length === 0) {
      html += '<div class="empty-state">'
        + '<div class="empty-state-icon">\uD83D\uDCE1</div>'
        + '<div class="empty-state-title">No activity yet</div>'
        + '<div class="empty-state-desc">Agent dispatches, task updates, and system events will appear here in real-time.</div>'
        + '</div>';
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
        var bgColor = 'rgba(255,255,255,0.05)';
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

  // Inbox view: severity-tiered notifications with action buttons
  function renderInbox(container) {
    var severityMap = { error: { cls: 'badge-red', label: 'CRITICAL' }, warning: { cls: 'badge-orange', label: 'WARNING' }, action: { cls: 'badge-blue', label: 'ACTION' }, info: { cls: 'badge-green', label: 'INFO' } };
    var notifications = state.notifications || [];
    var inboxFilter = container._inboxFilter || 'all';
    var showDismissed = container._showDismissed || false;

    var filtered = notifications.filter(function (n) {
      if (!showDismissed && n.dismissed) return false;
      if (inboxFilter !== 'all' && n.type !== inboxFilter) return false;
      return true;
    });

    var unreadCount = notifications.filter(function (n) { return !n.read && !n.dismissed; }).length;

    var html = '<div class="inbox-header"><h2 class="section-header"><span class="section-header-icon">\uD83D\uDCE5</span> Inbox '
      + (unreadCount > 0 ? '<span class="unread-badge">' + unreadCount + '</span>' : '')
      + '</h2></div>';

    html += '<div class="inbox-filters">';
    var filters = [{ key: 'all', label: 'All' }, { key: 'error', label: 'Critical' }, { key: 'warning', label: 'Warning' }, { key: 'info', label: 'Info' }];
    filters.forEach(function (f) {
      html += '<button class="inbox-filter' + (inboxFilter === f.key ? ' active' : '') + '" data-filter="' + f.key + '">' + f.label + '</button>';
    });
    html += '</div>';

    if (filtered.length === 0) {
      html += '<div class="empty-state">'
        + '<div class="empty-state-icon">\u2705</div>'
        + '<div class="empty-state-title">All clear</div>'
        + '<div class="empty-state-desc">No notifications to show.</div>'
        + '</div>';
    } else {
      html += '<div class="notification-list">';
      filtered.forEach(function (n) {
        var sev = severityMap[n.type] || severityMap.info;
        var readClass = n.read ? ' read' : ' unread';
        html += '<div class="notification-card severity-' + esc(n.type) + readClass + '" data-notif-id="' + esc(n.id) + '">'
          + '<div class="notification-header">'
          + '<span class="badge ' + sev.cls + '">' + sev.label + '</span>'
          + '<span class="notification-title">' + esc(n.title) + '</span>'
          + '<span class="notification-time">' + timeAgo(n.created_at) + '</span>'
          + '</div>'
          + '<div class="notification-body">' + esc(n.body ? n.body.substring(0, 120) : '') + '</div>'
          + '<div class="notification-actions">'
          + '<button class="btn" data-action="notif-view" data-nid="' + esc(n.id) + '">View</button>'
          + '<button class="btn" data-action="notif-dismiss" data-nid="' + esc(n.id) + '">Dismiss</button>'
          + '<button class="btn" data-action="notif-escalate" data-nid="' + esc(n.id) + '">Escalate</button>'
          + '</div></div>';
      });
      html += '</div>';
    }

    html += '<div style="margin-top: var(--space-lg); text-align: center;">'
      + '<button class="btn" data-action="toggle-dismissed">' + (showDismissed ? 'Hide dismissed' : 'Show dismissed') + '</button></div>';

    container.innerHTML = html;

    container.addEventListener('click', function (e) {
      var filterBtn = e.target.closest('[data-filter]');
      if (filterBtn) {
        container._inboxFilter = filterBtn.getAttribute('data-filter');
        container.innerHTML = '';
        renderInbox(container);
        return;
      }
      var toggleBtn = e.target.closest('[data-action="toggle-dismissed"]');
      if (toggleBtn) {
        container._showDismissed = !container._showDismissed;
        container.innerHTML = '';
        renderInbox(container);
        return;
      }
      var actionBtn = e.target.closest('[data-action^="notif-"]');
      if (!actionBtn) return;
      var action = actionBtn.getAttribute('data-action');
      var nid = actionBtn.getAttribute('data-nid');
      if (!nid) return;
      var actionMap = { 'notif-view': 'read', 'notif-dismiss': 'dismiss', 'notif-escalate': 'escalate' };
      var apiAction = actionMap[action];
      if (!apiAction) return;
      actionBtn.textContent = '...';
      actionBtn.disabled = true;
      api('/notifications/' + nid, { method: 'PATCH', body: { action: apiAction } })
        .then(function () {
          loadNotifications().catch(function () {});
          if (action === 'notif-view') {
            var notif = state.notifications.find(function (n) { return String(n.id) === String(nid); });
            if (notif && notif.action_type === 'view_run') {
              location.hash = '#/activity';
            }
          }
        })
        .catch(function () { actionBtn.textContent = apiAction; actionBtn.disabled = false; });
    });
  }

  // Crons view: table + 24h SAST timeline
  function renderCrons(container) {
    var requestId = Date.now() + ':' + Math.random().toString(36).slice(2);
    container._viewRequestId = requestId;
    container.innerHTML = '<h2 class="section-header"><span class="section-header-icon">\u23F0</span> Cron Schedule</h2>'
      + '<div class="empty-state"><div class="spinner"></div> Loading...</div>';

    api('/crons').then(function (data) {
      if (container._viewRequestId !== requestId || state.activeTab !== 'crons') return;
      var raw = data.crons || data || {};
      var crons = raw.jobs || (Array.isArray(raw) ? raw : []);
      var html = '<h2 class="section-header"><span class="section-header-icon">\u23F0</span> Cron Schedule</h2>';

      // Table
      html += '<table class="cron-table"><thead><tr><th>Name</th><th>Agent</th><th>Schedule</th><th>Next Run</th><th>Status</th></tr></thead><tbody>';
      crons.forEach(function (c) {
        var aid = c.agentId || c.agent || '';
        var agentColor = AGENT_COLORS[aid] || 'var(--text-muted)';
        var sched = (c.schedule && c.schedule.expr) ? c.schedule.expr : (typeof c.schedule === 'string' ? c.schedule : '');
        var tz = (c.schedule && c.schedule.tz) ? ' (' + c.schedule.tz + ')' : '';
        var nextRun = (c.state && c.state.nextRunAtMs) ? new Date(c.state.nextRunAtMs).toLocaleString('en-ZA', {timeZone:'Africa/Johannesburg', hour:'2-digit', minute:'2-digit', month:'short', day:'numeric'}) : '-';
        var st = (c.state && c.state.lastStatus) || 'idle';
        var stClass = st === 'ok' ? 'badge-success' : st === 'error' ? 'badge-error' : 'badge-default';
        html += '<tr><td>' + esc(c.name || '') + '</td>'
          + '<td><span class="badge" style="background: rgba(255,255,255,0.05); color: ' + agentColor + '">' + esc(aid) + '</span></td>'
          + '<td style="font-family: var(--font-mono); font-size: var(--font-size-xs)">' + esc(sched + tz) + '</td>'
          + '<td>' + esc(nextRun) + '</td>'
          + '<td><span class="badge ' + stClass + '">' + esc(st) + '</span></td></tr>';
      });
      html += '</tbody></table>';

      // 24h SAST Timeline
      html += '<h3 style="font-size: var(--font-size-md); margin-top: var(--space-xl); margin-bottom: var(--space-sm); color: var(--text-secondary);">24h SAST Timeline</h3>';
      html += '<div class="timeline-container">';
      html += '<div class="timeline-hours">';
      [0, 3, 6, 9, 12, 15, 18, 21].forEach(function (h) {
        html += '<span>' + (h < 10 ? '0' : '') + h + '</span>';
      });
      html += '</div>';

      // Current time indicator (SAST = UTC+2)
      var now = new Date();
      var utcH = now.getUTCHours();
      var utcM = now.getUTCMinutes();
      var sastH = (utcH + 2) % 24;
      var nowPct = ((sastH + utcM / 60) / 24 * 100);
      html += '<div class="timeline-now" style="left: ' + nowPct + '%"></div>';

      // Cron markers - track used positions to avoid overlap
      var usedPositions = [];
      crons.forEach(function (c) {
        var expr = (c.schedule && c.schedule.expr) ? c.schedule.expr : (typeof c.schedule === 'string' ? c.schedule : '');
        var match = expr.match(/^\d+\s+(\d+)\s/);
        if (match) {
          var hour = parseInt(match[1], 10);
          var pct = (hour / 24 * 100);
          var aid = c.agentId || c.agent || '';
          var agentColor = AGENT_COLORS[aid] || 'var(--text-muted)';
          // Offset overlapping labels
          var labelOffset = 24;
          for (var u = 0; u < usedPositions.length; u++) {
            if (Math.abs(usedPositions[u] - pct) < 5) {
              labelOffset += 14;
            }
          }
          usedPositions.push(pct);
          html += '<div class="timeline-marker" style="left: ' + pct + '%; background: ' + agentColor + '; color: ' + agentColor + '" title="' + esc(c.name) + ' (' + esc(aid) + ')"></div>';
          html += '<span class="timeline-label" style="left: ' + pct + '%; bottom: ' + labelOffset + 'px">' + esc(c.name || '') + '</span>';
        }
      });

      html += '</div>';

      if (data.source) {
        html += '<div style="margin-top: var(--space-sm); font-size: var(--font-size-xs); color: var(--text-muted);">Source: ' + esc(data.source) + '</div>';
      }

      container.innerHTML = html;
    }).catch(function () {
      if (container._viewRequestId !== requestId || state.activeTab !== 'crons') return;
      container.innerHTML = '<h2 class="section-header"><span class="section-header-icon">\u23F0</span> Cron Schedule</h2>'
        + '<div class="empty-state">'
        + '<div class="empty-state-icon">\u26A0\uFE0F</div>'
        + '<div class="empty-state-title">Failed to load cron data</div>'
        + '</div>';
    });
  }

  // Briefs viewer: list with inline expand/collapse
  function renderBriefs(container) {
    var navGen = _navGeneration;
    container.innerHTML = '<h2 class="section-header"><span class="section-header-icon">\uD83D\uDCF0</span> Daily Briefs</h2>'
      + '<div class="empty-state"><div class="spinner"></div> Loading...</div>';

    api('/briefs').then(function (data) {
      if (navGen !== _navGeneration) return;
      var briefs = data.briefs || [];
      var html = '<h2 class="section-header"><span class="section-header-icon">\uD83D\uDCF0</span> Daily Briefs</h2>';
      if (briefs.length === 0) {
        html += '<div class="empty-state">'
          + '<div class="empty-state-icon">\uD83D\uDCF0</div>'
          + '<div class="empty-state-title">No briefs found</div>'
          + '<div class="empty-state-desc">Scout\'s daily intelligence briefs will appear here.</div>'
          + '</div>';
      } else {
        html += '<div class="file-list">';
        briefs.forEach(function (b) {
          html += '<div class="file-item" data-action="toggle-brief" data-filename="' + esc(b.filename) + '">'
            + '<div class="file-item-name">\uD83D\uDCC4 ' + esc(b.filename) + '</div>'
            + '<div class="file-item-meta">' + esc(b.date || '') + '</div>'
            + '<div class="file-item-content" style="display: none;" id="brief-content-' + esc(b.filename).replace(/[^a-zA-Z0-9]/g, '-') + '"></div>'
            + '</div>';
        });
        html += '</div>';
      }
      container.innerHTML = html;
      container.addEventListener('click', function (e) {
        var item = e.target.closest('[data-action="toggle-brief"]');
        if (!item) return;
        var filename = item.getAttribute('data-filename');
        var contentId = 'brief-content-' + filename.replace(/[^a-zA-Z0-9]/g, '-');
        var contentEl = document.getElementById(contentId);
        if (!contentEl) return;

        if (contentEl.style.display === 'none') {
          // Expand
          item.classList.add('file-item-expanded');
          contentEl.style.display = 'block';
          if (!contentEl._loaded) {
            contentEl.innerHTML = '<div class="empty-state" style="padding: var(--space-sm)"><div class="spinner"></div> Loading...</div>';
            api('/briefs/' + encodeURIComponent(filename)).then(function (data) {
              contentEl.innerHTML = '<div class="md-viewer" style="max-width: none; border: none; padding: var(--space-md);">' + renderMarkdown(data.content) + '</div>';
              contentEl._loaded = true;
            }).catch(function () {
              contentEl.innerHTML = '<div class="empty-state" style="padding: var(--space-sm)">Failed to load</div>';
            });
          }
        } else {
          // Collapse
          item.classList.remove('file-item-expanded');
          contentEl.style.display = 'none';
        }
      });
    }).catch(function () {
      if (navGen !== _navGeneration) return;
      container.innerHTML = '<h2 class="section-header"><span class="section-header-icon">\uD83D\uDCF0</span> Daily Briefs</h2>'
        + '<div class="empty-state"><div class="empty-state-icon">\u26A0\uFE0F</div><div class="empty-state-title">Failed to load briefs</div></div>';
    });
  }

  // Audits viewer: list with inline expand/collapse
  function renderAudits(container) {
    var navGen = _navGeneration;
    container.innerHTML = '<h2 class="section-header"><span class="section-header-icon">\uD83D\uDEE1\uFE0F</span> Security Audits</h2>'
      + '<div class="empty-state"><div class="spinner"></div> Loading...</div>';

    api('/audits').then(function (data) {
      if (navGen !== _navGeneration) return;
      var audits = data.audits || [];
      var html = '<h2 class="section-header"><span class="section-header-icon">\uD83D\uDEE1\uFE0F</span> Security Audits</h2>';
      if (audits.length === 0) {
        html += '<div class="empty-state">'
          + '<div class="empty-state-icon">\uD83D\uDEE1\uFE0F</div>'
          + '<div class="empty-state-title">No audits found</div>'
          + '<div class="empty-state-desc">Sentinel\'s security audit reports will appear here.</div>'
          + '</div>';
      } else {
        html += '<div class="file-list">';
        audits.forEach(function (a) {
          html += '<div class="file-item" data-action="toggle-audit" data-filename="' + esc(a.filename) + '">'
            + '<div class="file-item-name">\uD83D\uDD12 ' + esc(a.filename) + '</div>'
            + '<div class="file-item-content" style="display: none;" id="audit-content-' + esc(a.filename).replace(/[^a-zA-Z0-9]/g, '-') + '"></div>'
            + '</div>';
        });
        html += '</div>';
      }
      container.innerHTML = html;
      container.addEventListener('click', function (e) {
        var item = e.target.closest('[data-action="toggle-audit"]');
        if (!item) return;
        var filename = item.getAttribute('data-filename');
        var contentId = 'audit-content-' + filename.replace(/[^a-zA-Z0-9]/g, '-');
        var contentEl = document.getElementById(contentId);
        if (!contentEl) return;

        if (contentEl.style.display === 'none') {
          item.classList.add('file-item-expanded');
          contentEl.style.display = 'block';
          if (!contentEl._loaded) {
            contentEl.innerHTML = '<div class="empty-state" style="padding: var(--space-sm)"><div class="spinner"></div> Loading...</div>';
            api('/audits/' + encodeURIComponent(filename)).then(function (data) {
              contentEl.innerHTML = '<div class="md-viewer" style="max-width: none; border: none; padding: var(--space-md);">' + renderMarkdown(data.content) + '</div>';
              contentEl._loaded = true;
            }).catch(function () {
              contentEl.innerHTML = '<div class="empty-state" style="padding: var(--space-sm)">Failed to load</div>';
            });
          }
        } else {
          item.classList.remove('file-item-expanded');
          contentEl.style.display = 'none';
        }
      });
    }).catch(function () {
      if (navGen !== _navGeneration) return;
      container.innerHTML = '<h2 class="section-header"><span class="section-header-icon">\uD83D\uDEE1\uFE0F</span> Security Audits</h2>'
        + '<div class="empty-state"><div class="empty-state-icon">\u26A0\uFE0F</div><div class="empty-state-title">Failed to load audits</div></div>';
    });
  }

  // Portfolio viewer: list with inline expand/collapse
  function renderPortfolio(container) {
    var navGen = _navGeneration;
    container.innerHTML = '<h2 class="section-header"><span class="section-header-icon">\uD83D\uDCC8</span> Portfolio Reports</h2>'
      + '<div class="empty-state"><div class="spinner"></div> Loading...</div>';

    api('/portfolio').then(function (data) {
      if (navGen !== _navGeneration) return;
      var files = data.portfolio || [];
      var html = '<h2 class="section-header"><span class="section-header-icon">\uD83D\uDCC8</span> Portfolio Reports</h2>';
      if (files.length === 0) {
        html += '<div class="empty-state">'
          + '<div class="empty-state-icon">\uD83D\uDCC8</div>'
          + '<div class="empty-state-title">No portfolio reports found</div>'
          + '<div class="empty-state-desc">Broker\'s investment reports will appear here.</div>'
          + '</div>';
      } else {
        html += '<div class="file-list">';
        files.forEach(function (f) {
          html += '<div class="file-item" data-action="toggle-portfolio" data-filename="' + esc(f.filename) + '">'
            + '<div class="file-item-name">\uD83D\uDCCA ' + esc(f.filename) + '</div>'
            + '<div class="file-item-content" style="display: none;" id="portfolio-content-' + esc(f.filename).replace(/[^a-zA-Z0-9]/g, '-') + '"></div>'
            + '</div>';
        });
        html += '</div>';
      }
      container.innerHTML = html;
      container.addEventListener('click', function (e) {
        var item = e.target.closest('[data-action="toggle-portfolio"]');
        if (!item) return;
        var filename = item.getAttribute('data-filename');
        var contentId = 'portfolio-content-' + filename.replace(/[^a-zA-Z0-9]/g, '-');
        var contentEl = document.getElementById(contentId);
        if (!contentEl) return;

        if (contentEl.style.display === 'none') {
          item.classList.add('file-item-expanded');
          contentEl.style.display = 'block';
          if (!contentEl._loaded) {
            contentEl.innerHTML = '<div class="empty-state" style="padding: var(--space-sm)"><div class="spinner"></div> Loading...</div>';
            api('/portfolio/' + encodeURIComponent(filename)).then(function (data) {
              contentEl.innerHTML = '<div class="md-viewer" style="max-width: none; border: none; padding: var(--space-md);">' + renderMarkdown(data.content) + '</div>';
              contentEl._loaded = true;
            }).catch(function () {
              contentEl.innerHTML = '<div class="empty-state" style="padding: var(--space-sm)">Failed to load</div>';
            });
          }
        } else {
          item.classList.remove('file-item-expanded');
          contentEl.style.display = 'none';
        }
      });
    }).catch(function () {
      if (navGen !== _navGeneration) return;
      container.innerHTML = '<h2 class="section-header"><span class="section-header-icon">\uD83D\uDCC8</span> Portfolio Reports</h2>'
        + '<div class="empty-state"><div class="empty-state-icon">\u26A0\uFE0F</div><div class="empty-state-title">Failed to load portfolio</div></div>';
    });
  }

  // Memory browser: search + file list with inline expand
  function renderMemory(container) {
    var requestId = Date.now() + ':' + Math.random().toString(36).slice(2);
    container._viewRequestId = requestId;
    var html = '<h2 class="section-header"><span class="section-header-icon">\uD83E\uDDE0</span> Memory Browser</h2>';
    html += '<div class="memory-search">'
      + '<input class="input" type="text" id="memory-query" placeholder="Search Karpathy memory wiki..." />'
      + '<button class="btn btn-primary" data-action="memory-search">Search</button>'
      + '</div>';
    html += '<div id="memory-results" class="memory-results"></div>';
    html += '<h3 style="font-size: var(--font-size-md); margin-bottom: var(--space-sm); color: var(--text-secondary);">Memory Files</h3>';
    html += '<div id="memory-files" class="file-list"><div class="empty-state"><div class="spinner"></div> Loading...</div></div>';
    html += '<div id="memory-viewer"></div>';

    container.innerHTML = html;

    // Load memory file list
    api('/memory').then(function (data) {
      if (container._viewRequestId !== requestId || state.activeTab !== 'memory') return;
      var filesContainer = container.querySelector('#memory-files');
      if (!filesContainer) return;
      var files = data.files || [];
      var fhtml = '';
      if (data.has_memory_md) {
        fhtml += '<div class="file-item" data-action="open-memory" data-filename="MEMORY.md" style="border-left: 3px solid var(--accent-green)">'
          + '<div class="file-item-name" style="color: var(--accent-green)">\uD83E\uDDE0 MEMORY.md</div>'
          + '<div class="file-item-meta">Top-level memory index</div></div>';
      }
      if (files.length === 0 && !data.has_memory_md) {
        fhtml = '<div class="empty-state">'
          + '<div class="empty-state-icon">\uD83E\uDDE0</div>'
          + '<div class="empty-state-title">No memory files found</div>'
          + '<div class="empty-state-desc">Karpathy-style memory wiki files will appear here.</div>'
          + '</div>';
      } else {
        files.forEach(function (f) {
          fhtml += '<div class="file-item" data-action="open-memory" data-filename="' + esc(f) + '">'
            + '<div class="file-item-name">\uD83D\uDCC4 ' + esc(f) + '</div></div>';
        });
      }
      filesContainer.innerHTML = fhtml;
    }).catch(function () {
      if (container._viewRequestId !== requestId || state.activeTab !== 'memory') return;
      var filesContainer = container.querySelector('#memory-files');
      if (filesContainer) filesContainer.innerHTML = '<div class="empty-state"><div class="empty-state-icon">\u26A0\uFE0F</div><div class="empty-state-title">Failed to load memory files</div></div>';
    });

    // Event delegation
    container.addEventListener('click', function (e) {
      var searchBtn = e.target.closest('[data-action="memory-search"]');
      if (searchBtn) {
        var queryInput = document.getElementById('memory-query');
        var query = queryInput ? queryInput.value.trim() : '';
        if (!query) return;
        var resultsDiv = container.querySelector('#memory-results');
        if (resultsDiv) resultsDiv.innerHTML = '<div class="empty-state"><div class="spinner"></div> Searching...</div>';
        api('/memory/search?q=' + encodeURIComponent(query)).then(function (data) {
          if (container._viewRequestId !== requestId || state.activeTab !== 'memory') return;
          var results = data.results || [];
          if (!resultsDiv) return;
          if (results.length === 0) {
            resultsDiv.innerHTML = '<div class="empty-state"><div class="empty-state-icon">\uD83D\uDD0D</div><div class="empty-state-title">No results found</div></div>';
          } else {
            var rhtml = '<div style="font-size: var(--font-size-xs); color: var(--text-muted); margin-bottom: var(--space-sm);">' + results.length + ' result' + (results.length !== 1 ? 's' : '') + ' found</div>';
            var escapedQuery = esc(query);
            var queryRegex = new RegExp('(' + escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
            results.forEach(function (r) {
              var text = esc(r.text || r.content || JSON.stringify(r));
              text = text.replace(queryRegex, '<mark>$1</mark>');
              rhtml += '<div class="memory-result">' + text + '</div>';
            });
            resultsDiv.innerHTML = rhtml;
          }
        }).catch(function () {
          if (resultsDiv) resultsDiv.innerHTML = '<div class="empty-state"><div class="empty-state-icon">\u26A0\uFE0F</div><div class="empty-state-title">Search failed</div></div>';
        });
        return;
      }

      var memItem = e.target.closest('[data-action="open-memory"]');
      if (memItem) {
        var filename = memItem.getAttribute('data-filename');
        var viewer = container.querySelector('#memory-viewer');
        if (!viewer) return;
        viewer.innerHTML = '<div class="empty-state"><div class="spinner"></div> Loading...</div>';
        api('/memory/' + encodeURIComponent(filename)).then(function (data) {
          if (container._viewRequestId !== requestId || state.activeTab !== 'memory') return;
          viewer.innerHTML = '<button class="btn btn-back" data-action="close-memory-viewer">\u2190 Close</button>'
            + '<h3 style="font-size: var(--font-size-md); margin: var(--space-md) 0;">' + esc(data.filename) + '</h3>'
            + '<div class="md-viewer">' + renderMarkdown(data.content) + '</div>';
        }).catch(function () {
          viewer.innerHTML = '<div class="empty-state"><div class="empty-state-icon">\u26A0\uFE0F</div><div class="empty-state-title">Failed to load file</div></div>';
        });
        return;
      }

      var closeBtn = e.target.closest('[data-action="close-memory-viewer"]');
      if (closeBtn) {
        var viewer = container.querySelector('#memory-viewer');
        if (viewer) viewer.innerHTML = '';
      }
    });

    // Enter key for search
    var queryInput = container.querySelector('#memory-query');
    if (queryInput) {
      queryInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          var searchBtn = container.querySelector('[data-action="memory-search"]');
          if (searchBtn) searchBtn.click();
        }
      });
    }
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
      + '<button type="button" class="btn btn-shape" id="shape-task-detail-btn">Shape</button>'
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

    // Shape button in task detail
    overlay.querySelector('#shape-task-detail-btn').addEventListener('click', function () {
      overlay.remove();
      showInterviewOverlay(task.id);
    });

    // Dispatch button
    var dispatchBtn = overlay.querySelector('#dispatch-task-btn');
    dispatchBtn.addEventListener('click', function () {
      var agentSelect = overlay.querySelector('select[name="agent_id"]');
      var selectedAgent = agentSelect ? agentSelect.value : task.agent_id;
      dispatchBtn.textContent = 'Dispatching...';
      dispatchBtn.disabled = true;
      var dispatchBody = { task_id: task.id };
      if (selectedAgent) {
        dispatchBody.agent_id = selectedAgent;
      } else {
        dispatchBody.auto_route = true;
      }
      api('/dispatch', { method: 'POST', body: dispatchBody })
        .then(function (result) {
          overlay.remove();
          if (result.routed) {
            showToast('Routed to ' + result.agent_id + ' (' + (result.routing ? result.routing.confidence : '') + ')');
          }
        })
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
      + '<button type="button" class="btn btn-shape" id="shape-task-btn">Shape with Jarvis</button>'
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

    // Shape with Jarvis button
    overlay.querySelector('#shape-task-btn').addEventListener('click', function () {
      overlay.remove();
      showInterviewOverlay(null);
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

  // --- Toast Notification ---
  function showToast(message, duration) {
    duration = duration || 3000;
    var toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () {
      toast.classList.add('fade-out');
      setTimeout(function () { toast.remove(); }, 300);
    }, duration);
  }

  // --- INTEL-01: Interview/Shaping Mode ---
  function showInterviewOverlay(taskId) {
    var existing = document.querySelector('.overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.className = 'overlay interview-overlay';

    overlay.innerHTML = '<div class="overlay-content">'
      + '<div class="interview-header">'
      + '<h2 style="color: var(--accent-green); font-size: var(--font-size-lg);">Shape Task with Jarvis</h2>'
      + '<button class="btn" id="interview-close">Close</button>'
      + '</div>'
      + '<div class="interview-messages" id="interview-messages">'
      + '<div class="interview-typing"><div class="spinner"></div> Jarvis is thinking...</div>'
      + '</div>'
      + '<div id="interview-ready-area"></div>'
      + '<div class="interview-input-area">'
      + '<input class="input" type="text" id="interview-input" placeholder="Type your answer..." />'
      + '<button class="btn btn-primary" id="interview-send">Send</button>'
      + '</div>'
      + '</div>';

    document.body.appendChild(overlay);

    var sessionId = null;
    var messagesDiv = overlay.querySelector('#interview-messages');
    var inputEl = overlay.querySelector('#interview-input');
    var sendBtn = overlay.querySelector('#interview-send');
    var readyArea = overlay.querySelector('#interview-ready-area');

    overlay.querySelector('#interview-close').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

    function addBubble(role, content) {
      var bubble = document.createElement('div');
      bubble.className = 'interview-msg ' + role;
      if (role === 'assistant') {
        bubble.innerHTML = renderMarkdown(content);
      } else {
        bubble.textContent = content;
      }
      messagesDiv.appendChild(bubble);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function showTyping() {
      var el = document.createElement('div');
      el.className = 'interview-typing';
      el.id = 'interview-typing-indicator';
      el.innerHTML = '<div class="spinner"></div> Jarvis is thinking...';
      messagesDiv.appendChild(el);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function hideTyping() {
      var el = document.getElementById('interview-typing-indicator');
      if (el) el.remove();
    }

    // Start interview
    api('/interview/start', { method: 'POST', body: { task_id: taskId || undefined } })
      .then(function (data) {
        sessionId = data.session_id;
        messagesDiv.innerHTML = '';
        if (data.messages && data.messages.length > 0) {
          data.messages.forEach(function (m) { addBubble(m.role, m.content); });
        }
        inputEl.focus();
      })
      .catch(function (err) {
        messagesDiv.innerHTML = '<div class="empty-state">Failed to start interview: ' + esc(err.message) + '</div>';
      });

    function sendMessage() {
      var msg = inputEl.value.trim();
      if (!msg || !sessionId) return;
      inputEl.value = '';
      addBubble('user', msg);
      showTyping();
      inputEl.disabled = true;
      sendBtn.disabled = true;

      api('/interview/' + sessionId + '/reply', { method: 'POST', body: { message: msg } })
        .then(function (data) {
          hideTyping();
          inputEl.disabled = false;
          sendBtn.disabled = false;
          // Show latest assistant message
          var msgs = data.messages || [];
          if (msgs.length > 0) {
            var last = msgs[msgs.length - 1];
            if (last.role === 'assistant') addBubble('assistant', last.content);
          }
          // Check if completed
          if (data.status === 'completed') {
            inputEl.disabled = true;
            sendBtn.disabled = true;
            // Show ready banner
            var agentName = data.suggested_agent || 'jarvis';
            var agentDisplay = AGENTS.find(function (a) { return a.id === agentName; });
            var displayName = agentDisplay ? agentDisplay.name : agentName;

            var agentOptions = AGENTS.map(function (a) {
              var sel = a.id === agentName ? ' selected' : '';
              return '<option value="' + esc(a.id) + '"' + sel + '>' + esc(a.name) + ' - ' + esc(a.role) + '</option>';
            }).join('');

            readyArea.innerHTML = '<div class="interview-ready">'
              + '<h4>Task Ready</h4>'
              + '<p style="font-size: var(--font-size-sm); color: var(--text-secondary); margin-bottom: var(--space-sm);">'
              + '<strong>' + esc(data.refined_title || 'Refined Task') + '</strong></p>'
              + '<p style="font-size: var(--font-size-xs); color: var(--text-muted); margin-bottom: var(--space-md);">'
              + esc((data.refined_description || '').substring(0, 200)) + '</p>'
              + '<div style="display: flex; gap: var(--space-sm); align-items: center;">'
              + '<select id="interview-agent-override" style="flex: 1;">' + agentOptions + '</select>'
              + '<button class="btn btn-primary" id="interview-dispatch">Dispatch to ' + esc(displayName) + '</button>'
              + '</div></div>';

            var dispatchBtn = readyArea.querySelector('#interview-dispatch');
            var agentSelect = readyArea.querySelector('#interview-agent-override');
            agentSelect.addEventListener('change', function () {
              var sel = AGENTS.find(function (a) { return a.id === agentSelect.value; });
              dispatchBtn.textContent = 'Dispatch to ' + (sel ? sel.name : agentSelect.value);
            });
            dispatchBtn.addEventListener('click', function () {
              dispatchBtn.textContent = 'Dispatching...';
              dispatchBtn.disabled = true;
              api('/interview/' + sessionId + '/dispatch', {
                method: 'POST', body: { agent_id: agentSelect.value }
              }).then(function (result) {
                overlay.remove();
                showToast('Dispatched to ' + (result.agent_id || 'agent'));
                location.hash = '#/overview';
              }).catch(function (err) {
                dispatchBtn.textContent = 'Dispatch';
                dispatchBtn.disabled = false;
                showToast('Dispatch failed: ' + (err.data ? err.data.error : err.message));
              });
            });
          }
          inputEl.focus();
        })
        .catch(function (err) {
          hideTyping();
          inputEl.disabled = false;
          sendBtn.disabled = false;
          addBubble('assistant', 'Error: ' + (err.data ? err.data.error : err.message));
        });
    }

    sendBtn.addEventListener('click', sendMessage);
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') sendMessage();
    });
  }

  // --- INTEL-03: Projects Tab ---
  function renderProjects(container) {
    var requestId = Date.now() + ':' + Math.random().toString(36).slice(2);
    container._viewRequestId = requestId;
    var selectedProject = container._selectedProject || null;

    if (selectedProject) {
      container.innerHTML = '<button class="btn btn-back" data-action="projects-back">\u2190 Back</button>'
        + '<div class="empty-state"><div class="spinner"></div> Loading...</div>';
      api('/projects/' + selectedProject).then(function (data) {
        if (container._viewRequestId !== requestId || state.activeTab !== 'projects') return;
        var p = data.project;
        var html = '<button class="btn btn-back" data-action="projects-back">\u2190 Back</button>'
          + '<h2 style="font-size: var(--font-size-lg); margin-bottom: var(--space-sm);">'
          + '<span style="color: ' + esc(p.color || '#00ff41') + '">' + esc(p.name) + '</span>'
          + ' <span class="badge badge-green">' + esc(p.status) + '</span></h2>'
          + '<p style="font-size: var(--font-size-sm); color: var(--text-secondary); margin-bottom: var(--space-lg);">' + esc(p.description || '') + '</p>'
          + '<button class="btn" data-action="edit-project" data-pid="' + esc(p.id) + '" style="margin-bottom: var(--space-lg);">Edit Project</button>';

        // Tasks section
        html += '<div class="project-detail-section"><h3>Tasks (' + (data.tasks ? data.tasks.length : 0) + ')</h3>';
        if (data.tasks && data.tasks.length > 0) {
          html += '<div class="task-list">';
          data.tasks.forEach(function (t) {
            var statusCls = t.status === 'done' ? 'badge-green' : t.status === 'in_progress' ? 'badge-blue' : t.status === 'review' ? 'badge-orange' : 'text-muted';
            html += '<div class="task-item" data-action="view-task" data-task-id="' + esc(t.id) + '">'
              + '<span class="task-title">' + esc(t.title) + '</span>'
              + '<span class="badge ' + statusCls + '">' + esc(t.status) + '</span></div>';
          });
          html += '</div>';
        } else {
          html += '<div class="empty-state" style="padding: var(--space-md)">No tasks in this project</div>';
        }
        html += '</div>';

        // Runs section
        html += '<div class="project-detail-section"><h3>Recent Runs (' + (data.runs ? data.runs.length : 0) + ')</h3>';
        if (data.runs && data.runs.length > 0) {
          html += '<div class="activity-list">';
          data.runs.forEach(function (r) {
            var statusCls = r.status === 'completed' ? 'badge-green' : r.status === 'failed' ? 'badge-red' : 'badge-blue';
            html += '<div class="activity-item">'
              + '<span class="badge ' + statusCls + '">' + esc(r.status) + '</span>'
              + '<span>' + esc(r.agent_id) + ' - Task #' + esc(r.task_id) + '</span>'
              + '<span class="text-muted">' + timeAgo(r.created_at) + '</span>'
              + (r.estimated_cost_usd ? '<span class="agent-cost">$' + r.estimated_cost_usd.toFixed(4) + '</span>' : '')
              + '</div>';
          });
          html += '</div>';
        } else {
          html += '<div class="empty-state" style="padding: var(--space-md)">No runs yet</div>';
        }
        html += '</div>';

        // Docs section
        html += '<div class="project-detail-section"><h3>Documents (' + (data.docs ? data.docs.length : 0) + ')</h3>';
        if (data.docs && data.docs.length > 0) {
          html += '<div class="file-list">';
          data.docs.forEach(function (d) {
            html += '<div class="file-item"><div class="file-item-name">\uD83D\uDCC4 ' + esc(d) + '</div></div>';
          });
          html += '</div>';
        } else {
          html += '<div class="empty-state" style="padding: var(--space-md)">No documents found</div>';
        }
        html += '</div>';

        container.innerHTML = html;
      }).catch(function () {
        container.innerHTML = '<button class="btn btn-back" data-action="projects-back">\u2190 Back</button>'
          + '<div class="empty-state"><div class="empty-state-icon">\u26A0\uFE0F</div><div class="empty-state-title">Failed to load project</div></div>';
        container.querySelector('[data-action="projects-back"]').addEventListener('click', function () {
          container._selectedProject = null; container.innerHTML = ''; renderProjects(container);
        });
      });
      return;
    }

    container.innerHTML = '<h2 class="section-header"><span class="section-header-icon">\uD83D\uDCC1</span> Projects</h2>'
      + '<div class="empty-state"><div class="spinner"></div> Loading...</div>';

    api('/projects').then(function (data) {
      if (container._viewRequestId !== requestId || state.activeTab !== 'projects') return;
      var projects = data.projects || [];
      var html = '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-lg);">'
        + '<h2 class="section-header"><span class="section-header-icon">\uD83D\uDCC1</span> Projects</h2>'
        + '<button class="btn btn-primary" data-action="new-project">+ New Project</button></div>';

      if (projects.length === 0) {
        html += '<div class="empty-state">'
          + '<div class="empty-state-icon">\uD83D\uDCC1</div>'
          + '<div class="empty-state-title">No projects yet</div>'
          + '<div class="empty-state-desc">Projects group tasks, runs, and documents together. Create one to organize your agent workflows.</div>'
          + '</div>';
      } else {
        html += '<div class="project-grid">';
        projects.forEach(function (p) {
          var statusBadge = p.status === 'active' ? 'badge-green' : p.status === 'paused' ? 'badge-orange' : 'text-muted';
          html += '<div class="project-card" data-action="view-project" data-pid="' + esc(p.id) + '">'
            + '<div class="project-name" style="color: ' + esc(p.color || '#00ff41') + '">' + esc(p.name) + '</div>'
            + '<div class="project-desc">' + esc(p.description || '') + '</div>'
            + '<div class="project-stats">'
            + '<span>' + esc(p.active_task_count) + ' active / ' + esc(p.task_count) + ' total tasks</span>'
            + '<span class="badge ' + statusBadge + '">' + esc(p.status) + '</span>'
            + '</div></div>';
        });
        html += '</div>';
      }
      container.innerHTML = html;
    }).catch(function () {
      container.innerHTML = '<h2 class="section-header"><span class="section-header-icon">\uD83D\uDCC1</span> Projects</h2>'
        + '<div class="empty-state"><div class="empty-state-icon">\u26A0\uFE0F</div><div class="empty-state-title">Failed to load projects</div></div>';
    });

    container.onclick = function (e) {
      var back = e.target.closest('[data-action="projects-back"]');
      if (back) {
        container._selectedProject = null;
        container.innerHTML = '';
        renderProjects(container);
        return;
      }

      var viewTask = e.target.closest('[data-action="view-task"]');
      if (viewTask) {
        showTaskDetail(viewTask.getAttribute('data-task-id'));
        return;
      }

      var editBtn = e.target.closest('[data-action="edit-project"]');
      if (editBtn) {
        showEditProjectForm(editBtn.getAttribute('data-pid'));
        return;
      }

      var newBtn = e.target.closest('[data-action="new-project"]');
      if (newBtn) {
        showCreateProjectForm();
        return;
      }

      var card = e.target.closest('[data-action="view-project"]');
      if (card) {
        container._selectedProject = card.getAttribute('data-pid');
        container.innerHTML = '';
        renderProjects(container);
      }
    };
  }

  // --- Project Create Form ---
  function showCreateProjectForm() {
    var existing = document.querySelector('.overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.className = 'overlay';

    var presetColors = ['#00ff41', '#00aaff', '#ff8800', '#ff4444', '#aa77ff', '#00ddff'];
    var swatchHtml = presetColors.map(function (c, i) {
      return '<div class="color-swatch' + (i === 0 ? ' selected' : '') + '" data-color="' + c + '" style="background: ' + c + '"></div>';
    }).join('');

    overlay.innerHTML = '<div class="overlay-content">'
      + '<h2>New Project</h2>'
      + '<form id="create-project-form">'
      + '<div class="form-group"><label>Name</label><input class="input" type="text" name="name" required placeholder="Project name..." /></div>'
      + '<div class="form-group"><label>Description</label><textarea class="input" name="description" rows="2" placeholder="Optional description..."></textarea></div>'
      + '<div class="form-group"><label>Color</label><div class="color-swatches">' + swatchHtml + '</div><input type="hidden" name="color" value="#00ff41" /></div>'
      + '<div id="form-error" class="form-error hidden"></div>'
      + '<div class="form-actions"><button type="button" class="btn" id="cancel-project">Cancel</button><button type="submit" class="btn btn-primary">Create Project</button></div>'
      + '</form></div>';

    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#cancel-project').addEventListener('click', function () { overlay.remove(); });

    // Color swatch selection
    overlay.querySelectorAll('.color-swatch').forEach(function (swatch) {
      swatch.addEventListener('click', function () {
        overlay.querySelectorAll('.color-swatch').forEach(function (s) { s.classList.remove('selected'); });
        swatch.classList.add('selected');
        overlay.querySelector('input[name="color"]').value = swatch.getAttribute('data-color');
      });
    });

    overlay.querySelector('#create-project-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var form = e.target;
      var errorEl = overlay.querySelector('#form-error');
      errorEl.classList.add('hidden');
      var body = { name: form.name.value.trim(), description: form.description.value.trim(), color: form.color.value };
      if (!body.name) { errorEl.textContent = 'Name is required'; errorEl.classList.remove('hidden'); return; }
      try {
        await api('/projects', { method: 'POST', body: body });
        overlay.remove();
        // Re-render projects tab
        var main = document.getElementById('main-content');
        if (main && state.activeTab === 'projects') { main.innerHTML = ''; renderProjects(main); }
      } catch (err) {
        errorEl.textContent = (err.data && err.data.error) ? err.data.error : 'Failed to create project';
        errorEl.classList.remove('hidden');
      }
    });

    overlay.querySelector('input[name="name"]').focus();
  }

  // --- Project Edit Form ---
  function showEditProjectForm(projectId) {
    api('/projects/' + projectId).then(function (data) {
      var p = data.project;
      var existing = document.querySelector('.overlay');
      if (existing) existing.remove();
      var overlay = document.createElement('div');
      overlay.className = 'overlay';

      var presetColors = ['#00ff41', '#00aaff', '#ff8800', '#ff4444', '#aa77ff', '#00ddff'];
      var swatchHtml = presetColors.map(function (c) {
        return '<div class="color-swatch' + (c === p.color ? ' selected' : '') + '" data-color="' + c + '" style="background: ' + c + '"></div>';
      }).join('');

      var statusOpts = ['active', 'paused', 'archived'].map(function (s) {
        return '<option value="' + s + '"' + (s === p.status ? ' selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>';
      }).join('');

      overlay.innerHTML = '<div class="overlay-content">'
        + '<h2>Edit Project</h2>'
        + '<form id="edit-project-form">'
        + '<div class="form-group"><label>Name</label><input class="input" type="text" name="name" required value="' + esc(p.name) + '" /></div>'
        + '<div class="form-group"><label>Description</label><textarea class="input" name="description" rows="2">' + esc(p.description || '') + '</textarea></div>'
        + '<div class="form-group"><label>Status</label><select name="status">' + statusOpts + '</select></div>'
        + '<div class="form-group"><label>Color</label><div class="color-swatches">' + swatchHtml + '</div><input type="hidden" name="color" value="' + esc(p.color || '#00ff41') + '" /></div>'
        + '<div id="form-error" class="form-error hidden"></div>'
        + '<div class="form-actions"><button type="button" class="btn" id="cancel-edit-project">Cancel</button><button type="submit" class="btn btn-primary">Save</button></div>'
        + '</form></div>';

      document.body.appendChild(overlay);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
      overlay.querySelector('#cancel-edit-project').addEventListener('click', function () { overlay.remove(); });

      overlay.querySelectorAll('.color-swatch').forEach(function (swatch) {
        swatch.addEventListener('click', function () {
          overlay.querySelectorAll('.color-swatch').forEach(function (s) { s.classList.remove('selected'); });
          swatch.classList.add('selected');
          overlay.querySelector('input[name="color"]').value = swatch.getAttribute('data-color');
        });
      });

      overlay.querySelector('#edit-project-form').addEventListener('submit', async function (e) {
        e.preventDefault();
        var form = e.target;
        var errorEl = overlay.querySelector('#form-error');
        errorEl.classList.add('hidden');
        var body = { name: form.name.value.trim(), description: form.description.value.trim(), color: form.color.value, status: form.status.value };
        try {
          await api('/projects/' + projectId, { method: 'PATCH', body: body });
          overlay.remove();
          var main = document.getElementById('main-content');
          if (main && state.activeTab === 'projects') { main.innerHTML = ''; renderProjects(main); }
        } catch (err) {
          errorEl.textContent = (err.data && err.data.error) ? err.data.error : 'Failed to update project';
          errorEl.classList.remove('hidden');
        }
      });
    });
  }

  // --- INTEL-04: Load Projects ---
  async function loadProjects() {
    var data = await api('/projects');
    state.projects = data.projects || [];
  }

  // --- Spaces ---
  async function loadSpaces() {
    var data = await api('/spaces');
    state.spaces = data.spaces || [];
    if (!state.currentSpaceId && state.spaces.length) {
      state.currentSpaceId = state.spaces[0].id;
    }
  }

  function renderSidebar() {
    var el = document.getElementById('app-sidebar');
    if (!el) return;
    var spaces = state.spaces || [];
    var projects = state.projects || [];
    var collapsed = state.collapsedSpaces || {};
    var currentProjectId = state.currentProjectId;

    var html = '<div class="sidebar-head">'
      + '<span class="sidebar-title">Workspaces</span>'
      + '<button class="sidebar-add" data-action="new-space" title="New space">+</button>'
      + '</div>';

    if (!spaces.length) {
      html += '<div class="sidebar-empty">No spaces yet. Click + to create one.</div>';
      el.innerHTML = html;
      return;
    }

    spaces.forEach(function (space) {
      var spaceProjects = projects.filter(function (p) { return p.space_id === space.id; });
      var isCollapsed = collapsed[space.id];
      html += '<div class="sidebar-space" data-space-id="' + esc(space.id) + '" style="--space-color: ' + esc(space.color || '#FF2EC4') + '">'
        + '<div class="sidebar-space-header" data-action="toggle-space" data-space-id="' + esc(space.id) + '">'
        + '<span class="sidebar-space-chev">' + (isCollapsed ? '▶' : '▼') + '</span>'
        + '<span class="sidebar-space-dot"></span>'
        + '<span class="sidebar-space-name">' + esc(space.name) + '</span>'
        + '<span class="sidebar-space-count">' + spaceProjects.length + '</span>'
        + '<button class="sidebar-add sidebar-add-sm" data-action="new-project" data-space-id="' + esc(space.id) + '" title="New project in ' + esc(space.name) + '">+</button>'
        + '</div>';

      if (!isCollapsed) {
        html += '<div class="sidebar-projects">';
        if (!spaceProjects.length) {
          html += '<div class="sidebar-project-empty">No projects</div>';
        } else {
          spaceProjects.forEach(function (project) {
            var isActive = String(project.id) === String(currentProjectId);
            html += '<a class="sidebar-project' + (isActive ? ' active' : '') + '"'
              + ' href="#/board/' + esc(project.id) + '"'
              + ' data-project-id="' + esc(project.id) + '"'
              + ' style="--project-color: ' + esc(project.color || '#00F0FF') + '">'
              + '<span class="sidebar-project-dot"></span>'
              + '<span class="sidebar-project-name">' + esc(project.name) + '</span>'
              + (project.active_task_count ? '<span class="sidebar-project-count">' + esc(project.active_task_count) + '</span>' : '')
              + '</a>';
          });
        }
        html += '</div>';
      }
      html += '</div>';
    });

    el.innerHTML = html;

    // Delegate clicks once per render
    el.onclick = function (e) {
      var target = e.target.closest('[data-action]');
      if (!target) return;
      var action = target.getAttribute('data-action');
      if (action === 'toggle-space') {
        var sid = target.getAttribute('data-space-id');
        var next = Object.assign({}, state.collapsedSpaces);
        next[sid] = !next[sid];
        state.collapsedSpaces = next;
        renderSidebar();
      } else if (action === 'new-space') {
        e.preventDefault(); e.stopPropagation();
        promptNewSpace();
      } else if (action === 'new-project') {
        e.preventDefault(); e.stopPropagation();
        var spaceId = parseInt(target.getAttribute('data-space-id'), 10);
        promptNewProject(spaceId);
      }
    };
  }

  function promptNewSpace() {
    var name = prompt('Space name?');
    if (!name || !name.trim()) return;
    api('/spaces', { method: 'POST', body: { name: name.trim() } })
      .then(function () {
        return Promise.all([loadSpaces(), loadProjects()]);
      })
      .then(renderSidebar)
      .catch(function (err) { alert('Failed to create space: ' + (err.message || err)); });
  }

  function promptNewProject(spaceId) {
    var name = prompt('Project name?');
    if (!name || !name.trim()) return;
    api('/projects', { method: 'POST', body: { name: name.trim(), space_id: spaceId } })
      .then(function () {
        return loadProjects();
      })
      .then(renderSidebar)
      .catch(function (err) { alert('Failed to create project: ' + (err.message || err)); });
  }


  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme || 'dark');
  }

  function renderSettings(container) {
    var requestId = Date.now() + ':' + Math.random().toString(36).slice(2);
    container._viewRequestId = requestId;
    container.innerHTML = '<h2 class="section-header"><span class="section-header-icon">⚙️</span> Settings</h2>'
      + '<div class="empty-state"><div class="spinner"></div> Loading settings...</div>';

    api('/settings').then(function (data) {
      if (container._viewRequestId !== requestId || state.activeTab !== 'settings') return;
      var settings = data.settings || {};
      var runtimes = data.runtimes || [];
      var runtimeOptions = runtimes.map(function (rt) {
        var id = rt.id || rt.name;
        return '<option value="' + esc(id) + '"' + (id === settings.default_runtime ? ' selected' : '') + '>' + esc(id) + '</option>';
      }).join('');
      container.innerHTML = '<h2 class="section-header"><span class="section-header-icon">⚙️</span> Settings</h2>'
        + '<section class="card settings-panel">'
        + '<form id="settings-form" class="settings-form">'
        + '<label><span>Port</span><input class="input" name="port" type="number" min="1" max="65535" value="' + esc(settings.port || 3333) + '"></label>'
        + '<label><span>Workspace path</span><input class="input" name="workspace_path" type="text" value="' + esc(settings.workspace_path || '') + '"></label>'
        + '<label><span>Theme</span><select class="input" name="theme">'
        + '<option value="dark"' + (settings.theme === 'dark' ? ' selected' : '') + '>Dark</option>'
        + '<option value="light"' + (settings.theme === 'light' ? ' selected' : '') + '>Light</option>'
        + '<option value="system"' + (settings.theme === 'system' ? ' selected' : '') + '>System</option>'
        + '</select></label>'
        + '<label><span>Default runtime</span><select class="input" name="default_runtime">' + runtimeOptions + '</select></label>'
        + '<div class="settings-actions"><button class="btn btn-primary" type="submit">Save settings</button><a class="btn" href="/api/export">Export data</a></div>'
        + '<div class="settings-note">Theme applies immediately. Port and workspace path are saved, but require a server restart.</div>'
        + '<div id="settings-status" class="overview-meta"></div>'
        + '</form></section>';
      applyTheme(settings.theme || 'dark');
      var form = container.querySelector('#settings-form');
      var status = container.querySelector('#settings-status');
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var body = {
          port: Number(form.port.value),
          workspace_path: form.workspace_path.value,
          theme: form.theme.value,
          default_runtime: form.default_runtime.value
        };
        api('/settings', { method: 'PUT', body: JSON.stringify(body) }).then(function (saved) {
          applyTheme(saved.settings.theme || 'dark');
          status.textContent = 'Saved. Restart required for port/workspace changes.';
        }).catch(function (err) {
          status.textContent = 'Error: ' + (((err || {}).data || {}).error || err.message || 'failed to save');
        });
      });
      form.theme.addEventListener('change', function () { applyTheme(form.theme.value); });
    }).catch(function (err) {
      if (container._viewRequestId !== requestId || state.activeTab !== 'settings') return;
      container.innerHTML = '<h2 class="section-header"><span class="section-header-icon">⚙️</span> Settings</h2>'
        + '<div class="card overview-alert"><span class="badge badge-red">Error</span><span>' + esc((((err || {}).data || {}).error) || err.message || 'Failed to load settings') + '</span></div>';
    });
  }

  // --- Tab Router (hash-based) ---
  var tabs = {
    '#/overview': { render: renderOverview, label: 'Overview' },
    '#/board': { render: renderBoard, label: 'Board' },
    '#/agents': { render: renderAgents, label: 'Agents' },
    '#/activity': { render: renderActivityView, label: 'Activity' },
    '#/inbox': { render: renderInbox, label: 'Inbox' },
    '#/crons': { render: renderCrons, label: 'Crons' },
    '#/briefs': { render: renderBriefs, label: 'Briefs' },
    '#/audits': { render: renderAudits, label: 'Audits' },
    '#/portfolio': { render: renderPortfolio, label: 'Portfolio' },
    '#/memory': { render: renderMemory, label: 'Memory' },
    '#/projects': { render: renderProjects, label: 'Projects' },
    '#/settings': { render: renderSettings, label: 'Settings' }
  };

  function navigate() {
    var hash = location.hash || '#/overview';

    // Support #/board/:projectId — extract the project id, then fall through to /board route
    var boardMatch = hash.match(/^#\/board\/(\d+)$/);
    if (boardMatch) {
      state.currentProjectId = parseInt(boardMatch[1], 10);
      hash = '#/board';
    }

    var tab = tabs[hash];
    if (!tab) {
      hash = '#/board';
      tab = tabs[hash];
    }

    // Update active tab in state
    var tabName = hash.replace('#/', '');
    state.activeTab = tabName;

    // Re-render sidebar so the active project highlight follows navigation
    renderSidebar();

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
      _navGeneration++;
      delete main._selectedProject;
      delete main._viewRequestId;
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
          var routeMap = { '/overview': '#/overview', '/home': '#/overview', '/board': '#/board', '/agents': '#/agents', '/activity': '#/activity', '/inbox': '#/inbox', '/crons': '#/crons', '/briefs': '#/briefs', '/audits': '#/audits', '/portfolio': '#/portfolio', '/memory': '#/memory', '/projects': '#/projects' };
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
            // INTEL-02: @jarvis route: triggers auto-routing
            var dispatchBody = { agent_id: agentId, message: message };
            if (agentId === 'jarvis' && message.toLowerCase().indexOf('route:') === 0) {
              dispatchBody.message = message.substring(6).trim();
              dispatchBody.auto_route = true;
            }
            hint.textContent = 'Dispatching to ' + agentId + '...';
            input.disabled = true;
            api('/dispatch', { method: 'POST', body: dispatchBody })
              .then(function (result) {
                overlay.remove();
                if (result.routed) {
                  showToast('Routed to ' + result.agent_id + ' (' + (result.routing ? result.routing.confidence : '') + ')');
                }
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
        // INTEL-02: Long plain text (>20 chars) auto-routes instead of creating unassigned task
        if (value.length > 20) {
          hint.textContent = 'Auto-routing...';
          input.disabled = true;
          api('/dispatch', { method: 'POST', body: { agent_id: 'jarvis', message: value, auto_route: true } })
            .then(function (result) {
              overlay.remove();
              if (result.routed) {
                showToast('Routed to ' + result.agent_id + ' (' + (result.routing ? result.routing.confidence : '') + ')');
              }
            })
            .catch(function (err) {
              input.disabled = false;
              hint.textContent = (err.data && err.data.error) ? err.data.error : 'Dispatch failed';
            });
          return;
        }
        // Short plain text: create unassigned task
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

  document.addEventListener('click', function (e) {
    var commandTarget = e.target.closest('[data-action="open-command-bar"]');
    if (commandTarget) {
      e.preventDefault();
      showCommandBar();
      return;
    }

    var cleanTarget = e.target.closest('[data-action="clean-stale-runs"]');
    if (cleanTarget) {
      e.preventDefault();
      cleanTarget.disabled = true;
      cleanTarget.textContent = 'Cleaning...';
      api('/overview/clean-stale-runs', { method: 'POST', body: {} })
        .then(function (result) {
          showToast('Cleaned ' + (result.cleaned || 0) + ' stale run(s)');
          return Promise.all([loadActivity(), loadAgents()]);
        })
        .then(function () {
          var main = document.getElementById('main-content');
          if (main && state.activeTab === 'overview') { main.innerHTML = ''; renderOverview(main); }
        })
        .catch(function (err) {
          cleanTarget.disabled = false;
          cleanTarget.textContent = 'Clean stale runs';
          showToast((err.data && err.data.error) ? err.data.error : 'Cleanup failed');
        });
      return;
    }

    var missionTarget = e.target.closest('[data-action="mission-action"]');
    if (missionTarget) {
      e.preventDefault();
      var action = missionTarget.getAttribute('data-mission-action');
      var targetHash = missionTarget.getAttribute('data-target');
      var taskId = missionTarget.getAttribute('data-task-id');
      var agentId = missionTarget.getAttribute('data-agent-id');
      if (action === 'clean_stale_runs') {
        var cleanBtn = document.querySelector('[data-action="clean-stale-runs"]');
        if (cleanBtn) cleanBtn.click();
        return;
      }
      if (action === 'open_command_bar') {
        showCommandBar();
        return;
      }
      if (action === 'open_inbox') {
        location.hash = '#/inbox';
        return;
      }
      if (action === 'dispatch_task' && taskId && agentId) {
        missionTarget.disabled = true;
        missionTarget.textContent = 'Dispatching...';
        api('/dispatch', { method: 'POST', body: { task_id: Number(taskId), agent_id: agentId } })
          .then(function () { showToast('Dispatched task #' + taskId + ' to ' + agentId); location.hash = '#/board'; })
          .catch(function (err) { missionTarget.disabled = false; missionTarget.textContent = 'Dispatch'; showToast((err.data && err.data.error) ? err.data.error : 'Dispatch failed'); });
        return;
      }
      if (targetHash) location.hash = targetHash;
    }
  });

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
      '1': '#/overview', '2': '#/board', '3': '#/agents', '4': '#/activity', '5': '#/inbox',
      '6': '#/crons', '7': '#/briefs', '8': '#/audits', '9': '#/portfolio',
      '0': '#/projects'
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
    updateStatusBar();
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
    updateStatusBar();
    if (state.activeTab === 'agents') {
      var main = document.getElementById('main-content');
      if (main) {
        main.textContent = '';
        renderAgents(main);
      }
    }
  });

  onChange('notifications', function () {
    if (state.activeTab === 'inbox') {
      var main = document.getElementById('main-content');
      if (main) { main.textContent = ''; renderInbox(main); }
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

  onChange('projects', function () {
    if (state.activeTab === 'projects') {
      var main = document.getElementById('main-content');
      if (main) { main.innerHTML = ''; renderProjects(main); }
    }
  });

  // --- Initialization ---
  document.addEventListener('DOMContentLoaded', function () {
    // Load data in parallel -- catch errors gracefully (server may not be running)
    Promise.all([
      loadTasks().catch(function (err) { console.warn('Failed to load tasks:', err); }),
      loadActivity().catch(function (err) { console.warn('Failed to load activity:', err); }),
      loadAgents().catch(function (err) { console.warn('Failed to load agents:', err); }),
      loadNotifications().catch(function (err) { console.warn('Failed to load notifications:', err); }),
      loadProjects().catch(function (err) { console.warn('Failed to load projects:', err); }),
      loadSpaces().catch(function (err) { console.warn('Failed to load spaces:', err); })
    ]).then(function () {
      renderSidebar();
      // Initial route
      navigate();
      // Initial status bar update
      updateStatusBar();
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

    // Update status bar "last event" periodically
    setInterval(updateStatusBar, 10000);

    // ── Jarvis Chat Panel ──────────────────────────────────
    var chatMessages = document.getElementById('chat-messages');
    var chatInput = document.getElementById('chat-input');
    var chatSend = document.getElementById('chat-send');
    var chatToggle = document.getElementById('chat-toggle');
    var chatPanel = document.getElementById('chat-panel');
    var chatVoiceBtn = document.getElementById('chat-voice-btn');
    var chatVoiceState = document.getElementById('chat-voice-state');
    var chatVoiceDetail = document.getElementById('chat-voice-detail');
    var chatBusy = false;
    var chatVoiceReplyPending = false;
    var recognition = null;
    var recognitionRunning = false;
    var speechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

    function setVoiceState(stateName, detail) {
      if (chatVoiceState) {
        chatVoiceState.textContent = 'Voice ' + stateName;
        chatVoiceState.classList.remove('listening', 'thinking', 'speaking', 'error');
        if (stateName === 'listening' || stateName === 'thinking' || stateName === 'speaking' || stateName === 'error') {
          chatVoiceState.classList.add(stateName);
        }
      }
      if (chatVoiceDetail) {
        chatVoiceDetail.textContent = detail || '';
      }
      if (chatVoiceBtn) {
        chatVoiceBtn.classList.toggle('listening', stateName === 'listening');
        chatVoiceBtn.setAttribute('aria-pressed', stateName === 'listening' ? 'true' : 'false');
      }
    }

    function stopRecognition() {
      if (!recognition || !recognitionRunning) return;
      recognitionRunning = false;
      try { recognition.stop(); } catch (e) {}
    }

    function speakChatReply(text) {
      if (!text || !window.speechSynthesis) return;
      stopRecognition();
      window.speechSynthesis.cancel();
      var utter = new SpeechSynthesisUtterance(text);
      utter.onstart = function () {
        setVoiceState('speaking', 'Jarvis is replying out loud');
      };
      utter.onend = function () {
        setVoiceState('idle', 'Push to talk');
      };
      utter.onerror = function () {
        setVoiceState('error', 'Speech output failed');
      };
      window.speechSynthesis.speak(utter);
    }

    function addChatMsg(text, type) {
      var msg = document.createElement('div');
      msg.className = 'chat-msg ' + type;
      if (type === 'agent') {
        var name = document.createElement('div');
        name.className = 'chat-agent-name';
        name.textContent = 'Jarvis';
        msg.appendChild(name);
        var body = document.createElement('div');
        body.textContent = text;
        msg.appendChild(body);
      } else {
        msg.textContent = text;
      }
      chatMessages.appendChild(msg);
      chatMessages.scrollTop = chatMessages.scrollHeight;
      return msg;
    }

    function sendChat(overrideText, options) {
      if (chatBusy) return;
      var text = typeof overrideText === 'string' ? overrideText.trim() : chatInput.value.trim();
      if (!text) return;
      if (typeof overrideText !== 'string') {
        chatInput.value = '';
      } else {
        chatInput.value = '';
      }
      addChatMsg(text, 'user');

      var thinking = document.createElement('div');
      thinking.className = 'chat-msg thinking';
      thinking.textContent = 'Jarvis is thinking';
      chatMessages.appendChild(thinking);
      chatMessages.scrollTop = chatMessages.scrollHeight;

      chatBusy = true;
      chatInput.disabled = true;
      if (chatSend) chatSend.disabled = true;
      if (chatVoiceBtn) chatVoiceBtn.disabled = true;
      if (options && options.fromVoice) {
        chatVoiceReplyPending = true;
        setVoiceState('thinking', 'Sending your spoken prompt to Jarvis');
      }

      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        thinking.remove();
        var reply = data.response || data.error || 'No response';
        addChatMsg(reply, 'agent');
        if (chatVoiceReplyPending) {
          speakChatReply(reply);
          chatVoiceReplyPending = false;
        }
      })
      .catch(function(err) {
        thinking.remove();
        addChatMsg('Error: ' + err.message, 'agent');
        if (chatVoiceReplyPending) {
          setVoiceState('error', 'Chat request failed');
          chatVoiceReplyPending = false;
        }
      })
      .finally(function() {
        chatBusy = false;
        chatInput.disabled = false;
        if (chatSend) chatSend.disabled = false;
        if (chatVoiceBtn) chatVoiceBtn.disabled = false;
        chatInput.focus();
        if (!window.speechSynthesis || !window.speechSynthesis.speaking) {
          setVoiceState('idle', speechRecognitionCtor ? 'Push to talk' : 'Voice unavailable in this browser');
        }
      });
    }

    function initChatVoice() {
      if (!chatVoiceBtn || !chatVoiceState || !chatVoiceDetail) return;
      if (!speechRecognitionCtor) {
        chatVoiceBtn.disabled = true;
        setVoiceState('error', 'Voice input needs a Chromium-style browser');
        return;
      }
      recognition = new speechRecognitionCtor();
      recognition.lang = 'en-US';
      recognition.continuous = false;
      recognition.interimResults = true;

      var partial = '';
      var finalText = '';

      recognition.onstart = function () {
        recognitionRunning = true;
        partial = '';
        finalText = '';
        setVoiceState('listening', 'Speak now, I am listening');
      };

      recognition.onresult = function (event) {
        partial = '';
        for (var i = event.resultIndex; i < event.results.length; i++) {
          var transcript = event.results[i][0].transcript || '';
          if (event.results[i].isFinal) {
            finalText += transcript + ' ';
          } else {
            partial += transcript;
          }
        }
        var preview = (finalText || partial).trim();
        if (preview) {
          chatInput.value = preview;
          setVoiceState('listening', preview);
        }
      };

      recognition.onerror = function (event) {
        recognitionRunning = false;
        var detail = event && event.error ? ('Mic error: ' + event.error) : 'Voice capture failed';
        setVoiceState('error', detail);
      };

      recognition.onend = function () {
        recognitionRunning = false;
        var spoken = (finalText || partial).trim();
        if (spoken) {
          chatInput.value = spoken;
          sendChat(spoken, { fromVoice: true });
        } else if (!chatBusy) {
          setVoiceState('idle', 'Push to talk');
        }
      };

      chatVoiceBtn.addEventListener('click', function () {
        if (chatBusy) return;
        if (recognitionRunning) {
          stopRecognition();
          setVoiceState('idle', 'Voice capture stopped');
          return;
        }
        if (window.speechSynthesis) {
          window.speechSynthesis.cancel();
        }
        try {
          recognition.start();
        } catch (err) {
          setVoiceState('error', err && err.message ? err.message : 'Could not start microphone');
        }
      });

      setVoiceState('idle', 'Push to talk');
    }

    if (chatSend) chatSend.addEventListener('click', function () { sendChat(); });
    if (chatInput) chatInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
    initChatVoice();
    var chatReopen = document.getElementById('chat-reopen');

    function toggleChat(forceOpen) {
      if (forceOpen) {
        chatPanel.classList.remove('collapsed');
      } else {
        chatPanel.classList.toggle('collapsed');
      }
      var isCollapsed = chatPanel.classList.contains('collapsed');
      chatToggle.textContent = isCollapsed ? '\u25B6' : '\u25C0';
      if (chatReopen) {
        if (isCollapsed) { chatReopen.classList.add('visible'); }
        else { chatReopen.classList.remove('visible'); }
      }
    }

    if (chatToggle) chatToggle.addEventListener('click', function() { toggleChat(); });
    if (chatReopen) chatReopen.addEventListener('click', function() { toggleChat(true); chatInput.focus(); });

    // Welcome message
    if (chatMessages && chatMessages.children.length === 0) {
      addChatMsg('Online. What do you need?', 'agent');
    }

  });

})();
