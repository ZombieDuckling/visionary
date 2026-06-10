// Failover engine.
//
// `executeWithFailover` runs the given prompt on an agent's current harness.
// If the harness fails with a known rate-limit / quota / token-exhausted error,
// it walks the agent's harness_chain and retries on the next harness, replaying
// recent conversation turns so the new harness inherits context.

const { execFile, spawn } = require('node:child_process');
const rateLimiter = require('../rate-limiter');
const guardrails = require('../guardrails');
const { contextWindow } = require('../cookbook');

// Patterns we treat as "this harness is exhausted, try the next one".
const EXHAUSTION_PATTERNS = [
  /rate.?limit/i,
  /token.?limit/i,
  /quota/i,
  /usage.?limit/i,
  /exceeded/i,
  /\b429\b/,
  /insufficient.?credit/i,
  /not.?enough.?credit/i,
  /no.?credit/i,
  /payment.?required/i,
  /weekly.?limit/i,
  /upgrade.?your.?plan/i
];

function looksExhausted(output) {
  if (!output) return false;
  const text = String(output);
  return EXHAUSTION_PATTERNS.some((re) => re.test(text));
}

function looksNotInstalled(err) {
  return err && (err.code === 'ENOENT' || /not found|command not found/i.test(err.message || ''));
}

/**
 * Classify a finished attempt's combined output into a status.
 * Shared by the buffered and streaming runners so they agree on semantics.
 */
function classify(runtime, err, stdout, stderr) {
  const combined = String(stderr || '') + String(stdout || '');
  if (looksNotInstalled(err)) {
    return { status: 'not-installed', harness: runtime.name, stderr: (err && err.message) || 'not installed' };
  } else if (err && looksExhausted(combined)) {
    return { status: 'exhausted', harness: runtime.name, stdout, stderr: combined };
  } else if (err) {
    return { status: 'error', harness: runtime.name, stdout, stderr: combined };
  } else if (looksExhausted(combined)) {
    return { status: 'exhausted', harness: runtime.name, stdout, stderr: combined };
  }
  return { status: 'ok', harness: runtime.name, stdout: String(stdout || ''), stderr: String(stderr || '') };
}

/**
 * Buffered attempt — collects all stdout/stderr then classifies. Default path.
 * Resolves with `{ status, harness, stdout, stderr }` where status is one of:
 * 'ok' | 'exhausted' | 'not-installed' | 'error'.
 */
function runOnceBuffered(runtime, ctx, options) {
  return new Promise((resolve) => {
    const opts = Object.assign({ maxBuffer: 8 * 1024 * 1024, timeout: options.timeout || 120000 }, options);
    let cmd;
    try { cmd = runtime.buildCommand(ctx); }
    catch (err) { resolve({ status: 'error', harness: runtime.name, stderr: err.message }); return; }
    execFile(cmd.bin, cmd.args, opts, (err, stdout, stderr) => {
      resolve(classify(runtime, err, stdout, stderr));
    });
  });
}

/**
 * Streaming attempt — spawns the harness and forwards stdout/stderr chunks via
 * `options.onChunk(harness, chunk, stream)` as they arrive, while still
 * accumulating the full output so the result matches the buffered runner.
 * Hands the live child to `options.onChild(child)` so the caller can kill it.
 */
function runOnceStreaming(runtime, ctx, options) {
  return new Promise((resolve) => {
    let cmd;
    try { cmd = runtime.buildCommand(ctx); }
    catch (err) { resolve({ status: 'error', harness: runtime.name, stderr: err.message }); return; }

    const spawnOpts = {
      timeout: options.timeout || 120000,
      killSignal: 'SIGTERM',
      env: options.env || process.env,
      cwd: options.cwd,
      // Close stdin so CLIs that probe it (e.g. `claude -p`) don't stall ~3s
      // waiting for piped input that never comes.
      stdio: ['ignore', 'pipe', 'pipe']
    };

    let child;
    try { child = spawn(cmd.bin, cmd.args, spawnOpts); }
    catch (err) {
      resolve(classify(runtime, err, '', err.message));
      return;
    }
    if (typeof options.onChild === 'function') { try { options.onChild(child); } catch { /* ignore */ } }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (res) => { if (!settled) { settled = true; resolve(res); } };

    if (child.stdout) child.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      if (typeof options.onChunk === 'function') { try { options.onChunk(runtime.name, s, 'stdout'); } catch { /* ignore */ } }
    });
    if (child.stderr) child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      if (typeof options.onChunk === 'function') { try { options.onChunk(runtime.name, s, 'stderr'); } catch { /* ignore */ } }
    });

    child.on('error', (err) => {
      finish(classify(runtime, err, stdout, stderr));
    });
    child.on('close', (code, signal) => {
      // A non-zero exit OR a kill signal both mean "this attempt did not succeed".
      // Build a synthetic err object so classify() routes it correctly; exhaustion
      // text still wins over a plain error so failover keeps walking the chain.
      const err = (code === 0 && !signal) ? null : { message: signal ? ('killed by signal ' + signal) : ('exit code ' + code) };
      finish(classify(runtime, err, stdout, stderr));
    });
  });
}

/**
 * Run a single attempt on one harness. Streams when the caller supplies an
 * onChunk/onChild hook, otherwise uses the buffered runner.
 */
function runOnce(runtime, ctx, options) {
  return (typeof options.onChunk === 'function' || typeof options.onChild === 'function')
    ? runOnceStreaming(runtime, ctx, options)
    : runOnceBuffered(runtime, ctx, options);
}

const FALLBACK_REPLAY_TURNS = 10;

/**
 * Build the replay context block for a failover attempt.
 *
 * Uses guardrails.selectForReplay with the target harness's context window as
 * the ceiling. Falls back to a fixed slice of FALLBACK_REPLAY_TURNS if no
 * ceiling is known. The caller may supply an explicit `replayBudget` override
 * (token ceiling) via options.
 *
 * Returns { text, turnCount, estimatedTokens } so the caller can annotate the
 * attempt log.
 */
function buildReplayContext(messages, targetHarness, targetModel, options) {
  // messages come back newest-first from getRecentAgentMessages.
  if (!messages || messages.length === 0) return { text: '', turnCount: 0, estimatedTokens: 0 };

  let selected;
  let ceiling;

  if (typeof options.replayBudget === 'number' && options.replayBudget > 0) {
    // Explicit budget from dispatch body overrides everything.
    ceiling = options.replayBudget;
  } else {
    ceiling = contextWindow(targetHarness, targetModel);
  }

  if (ceiling) {
    // Leave ~20 % headroom for the new message + system prompt overhead.
    const safeceiling = Math.floor(ceiling * 0.8);
    selected = guardrails.selectForReplay(messages, safeceiling, true);
  } else {
    // Unknown harness — fall back to fixed-N newest turns, then reverse to chronological.
    const turns = typeof options.replayTurns === 'number' ? options.replayTurns : FALLBACK_REPLAY_TURNS;
    selected = messages.slice(0, turns).reverse();
  }

  if (selected.length === 0) return { text: '', turnCount: 0, estimatedTokens: 0 };

  const estimatedTokens = selected.reduce((s, m) => s + guardrails.estimateTokens(m.content), 0);
  const text = '\n\n[CONTEXT — last ' + selected.length + ' turns (' + estimatedTokens + ' est. tokens) from prior harness]\n'
    + selected.map((m) => '<' + m.role + '> ' + m.content).join('\n');

  return { text, turnCount: selected.length, estimatedTokens };
}

/**
 * Execute with automatic failover across the agent's harness_chain.
 *
 * @param {Object} deps - { getRuntime, stmts, db }
 * @param {Object} agent - row from `agents` table
 * @param {Object} ctx - { message, model? } passed to runtime.buildCommand
 * @param {Object} options - { timeout?, replayTurns?, replayBudget? }
 * @returns {Promise<{ status, harness, stdout, stderr, attempts, replayed }>}
 */
async function executeWithFailover(deps, agent, ctx, options) {
  options = options || {};
  const { getRuntime, stmts } = deps;

  // --- Rate limit check (before any harness attempt) ---
  if (!rateLimiter.acquire(agent.id)) {
    return { status: 'rate-limited', harness: null, stdout: '', stderr: 'Rate limit exceeded for agent ' + agent.id, attempts: [], replayed: 0 };
  }

  let chain;
  try { chain = JSON.parse(agent.harness_chain || '["openclaw"]'); }
  catch { chain = [agent.current_harness || 'openclaw']; }
  if (!Array.isArray(chain) || chain.length === 0) chain = ['openclaw'];

  // Start from the current_harness if it's in the chain; otherwise from the first entry.
  const startIdx = Math.max(0, chain.indexOf(agent.current_harness));
  const ordered = chain.slice(startIdx).concat(chain.slice(0, startIdx));

  // Fetch the replay buffer once — newest-first, large enough for selectForReplay to work with.
  const fetchLimit = Math.max(
    typeof options.replayTurns === 'number' ? options.replayTurns : FALLBACK_REPLAY_TURNS,
    100
  );
  const recentMessages = stmts.getRecentAgentMessages.all(agent.id, fetchLimit);

  const attempts = [];
  for (let i = 0; i < ordered.length; i++) {
    if (typeof options.isCancelled === 'function' && options.isCancelled()) {
      return { status: 'cancelled', harness: null, stdout: '', stderr: 'Dispatch cancelled', attempts, replayed: 0 };
    }
    const harness = ordered[i];
    let runtime;
    try { runtime = getRuntime(harness); }
    catch { attempts.push({ harness, status: 'unknown-harness' }); continue; }
    if (typeof options.onHarnessStart === 'function') { try { options.onHarnessStart(harness, i, ordered.length); } catch { /* ignore */ } }

    let fullMessage = ctx.message;
    let replayMeta = { turnCount: 0, estimatedTokens: 0 };

    if (i > 0) {
      const replay = buildReplayContext(recentMessages, harness, ctx.model, options);
      fullMessage = ctx.message + replay.text;
      replayMeta = { turnCount: replay.turnCount, estimatedTokens: replay.estimatedTokens };
    }

    const result = await runOnce(runtime, Object.assign({}, ctx, { message: fullMessage }), options);
    attempts.push({ harness, status: result.status });

    if (result.status === 'ok') {
      // Persist the turn + mark agent healthy on this harness
      try {
        stmts.insertAgentMessage.run({
          agent_id: agent.id, role: 'user', content: ctx.message, harness
        });
        stmts.insertAgentMessage.run({
          agent_id: agent.id, role: 'assistant', content: result.stdout, harness
        });
        stmts.setAgentHarness.run(harness, agent.id);
        stmts.setAgentHealth.run('ok', agent.id);
        stmts.setAgentActivity.run(agent.id);
        stmts.insertHealthLog.run({
          agent_id: agent.id, harness, status: 'ok',
          detail: i > 0 ? 'recovered after failover from ' + chain[startIdx] : null
        });
      } catch (e) { /* DB write failure should not mask success */ }
      return Object.assign({}, result, { attempts, replayed: replayMeta.turnCount });
    }

    // If the caller cancelled (e.g. user hit kill), stop here instead of
    // failing over to the next harness.
    if (typeof options.isCancelled === 'function' && options.isCancelled()) {
      return { status: 'cancelled', harness, stdout: result.stdout || '', stderr: result.stderr || 'Dispatch cancelled', attempts, replayed: 0 };
    }

    // Log the failure and move on
    try {
      stmts.insertHealthLog.run({
        agent_id: agent.id, harness, status: result.status,
        detail: (result.stderr || '').slice(0, 500)
      });
    } catch { /* ignore */ }
  }

  // All harnesses exhausted
  try {
    stmts.setAgentHealth.run('fail', agent.id);
  } catch { /* ignore */ }
  return { status: 'all-exhausted', harness: null, stdout: '', stderr: 'All harnesses exhausted', attempts, replayed: 0 };
}

module.exports = { executeWithFailover, looksExhausted };
