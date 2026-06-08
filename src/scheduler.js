// Scheduler — cron-style scheduled agent runs.
//
// Adapted from odysseus's task_scheduler + bg_jobs pattern. Minimal in-process
// scheduler: every minute, scan enabled rows in `schedules`, fire any whose
// cron expression matches the current minute, and dispatch their prompt to
// the named agent through executeWithFailover.
//
// Cron format: 5 fields — minute hour day-of-month month day-of-week. Values
// can be * (any), N (exact), N,M (list), N-M (range), or */N (step from 0).
// Examples:
//   '*/5 * * * *'   — every 5 minutes
//   '0 9 * * 1-5'   — 09:00 on weekdays
//   '0 7,12,18 * * *' — 07:00, 12:00, 18:00 every day

function parseField(expr, min, max) {
  if (expr === '*') {
    const set = new Set();
    for (let v = min; v <= max; v++) set.add(v);
    return set;
  }
  const set = new Set();
  const parts = String(expr).split(',');
  for (const part of parts) {
    let step = 1;
    let body = part;
    const stepMatch = body.match(/^(.+)\/(\d+)$/);
    if (stepMatch) {
      body = stepMatch[1];
      step = parseInt(stepMatch[2], 10) || 1;
    }
    let from = min;
    let to = max;
    if (body !== '*') {
      const rangeMatch = body.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        from = parseInt(rangeMatch[1], 10);
        to = parseInt(rangeMatch[2], 10);
      } else {
        const n = parseInt(body, 10);
        if (!Number.isFinite(n)) continue;
        from = n; to = n;
      }
    }
    for (let v = from; v <= to; v += step) {
      if (v >= min && v <= max) set.add(v);
    }
  }
  return set;
}

function parseCron(expr) {
  const fields = String(expr || '').trim().split(/\s+/);
  if (fields.length !== 5) throw new Error('Cron must be 5 fields, got ' + fields.length);
  return {
    minute:    parseField(fields[0], 0, 59),
    hour:      parseField(fields[1], 0, 23),
    dom:       parseField(fields[2], 1, 31),
    month:     parseField(fields[3], 1, 12),
    dow:       parseField(fields[4], 0, 6)  // 0 = Sunday
  };
}

function matches(parsed, date) {
  return parsed.minute.has(date.getMinutes())
    && parsed.hour.has(date.getHours())
    && parsed.dom.has(date.getDate())
    && parsed.month.has(date.getMonth() + 1)
    && parsed.dow.has(date.getDay());
}

/**
 * Run one scheduler tick. Returns array of fired schedule ids.
 *
 * @param {Object} deps - { stmts, fireSchedule(schedule) -> Promise<{status, detail}> }
 * @param {Date} [now]
 */
async function tick(deps, now) {
  const { stmts, fireSchedule } = deps;
  now = now || new Date();
  const fired = [];
  const schedules = stmts.getEnabledSchedules.all();
  for (const s of schedules) {
    let parsed;
    try { parsed = parseCron(s.cron); }
    catch (err) {
      stmts.markScheduleRun.run('error', 'invalid cron: ' + err.message, s.id);
      continue;
    }
    if (!matches(parsed, now)) continue;
    // Debounce: if this schedule already ran in the current minute, skip
    if (s.last_run_at) {
      const last = new Date(s.last_run_at.replace(' ', 'T') + 'Z');
      if (last.getUTCFullYear() === now.getUTCFullYear()
        && last.getUTCMonth() === now.getUTCMonth()
        && last.getUTCDate() === now.getUTCDate()
        && last.getUTCHours() === now.getUTCHours()
        && last.getUTCMinutes() === now.getUTCMinutes()) continue;
    }
    try {
      const result = await fireSchedule(s);
      stmts.markScheduleRun.run(result.status || 'ok', (result.detail || '').slice(0, 500), s.id);
      fired.push({ id: s.id, name: s.name, status: result.status });
    } catch (err) {
      stmts.markScheduleRun.run('error', String(err.message || err).slice(0, 500), s.id);
      fired.push({ id: s.id, name: s.name, status: 'error', error: err.message });
    }
  }
  return fired;
}

module.exports = { parseCron, matches, tick };
