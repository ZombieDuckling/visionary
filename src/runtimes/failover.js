// Failover engine.
//
// `executeWithFailover` runs the given prompt on an agent's current harness.
// If the harness fails with a known rate-limit / quota / token-exhausted error,
// it walks the agent's harness_chain and retries on the next harness, replaying
// the last N conversation turns so the new harness inherits context.

const { execFile } = require('node:child_process');

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
 * Run a single attempt on one harness. Resolves with `{ status, harness, stdout, stderr }`
 * where status is one of: 'ok' | 'exhausted' | 'not-installed' | 'error'.
 */
function runOnce(runtime, ctx, options) {
  return new Promise((resolve) => {
    const opts = Object.assign({ maxBuffer: 8 * 1024 * 1024, timeout: options.timeout || 120000 }, options);
    let cmd;
    try { cmd = runtime.buildCommand(ctx); }
    catch (err) { resolve({ status: 'error', harness: runtime.name, stderr: err.message }); return; }
    execFile(cmd.bin, cmd.args, opts, (err, stdout, stderr) => {
      const combined = String(stderr || '') + String(stdout || '');
      if (looksNotInstalled(err)) {
        resolve({ status: 'not-installed', harness: runtime.name, stderr: err.message });
      } else if (err && looksExhausted(combined)) {
        resolve({ status: 'exhausted', harness: runtime.name, stdout, stderr: combined });
      } else if (err) {
        resolve({ status: 'error', harness: runtime.name, stdout, stderr: combined });
      } else if (looksExhausted(combined)) {
        resolve({ status: 'exhausted', harness: runtime.name, stdout, stderr: combined });
      } else {
        resolve({ status: 'ok', harness: runtime.name, stdout: String(stdout || ''), stderr: String(stderr || '') });
      }
    });
  });
}

/**
 * Execute with automatic failover across the agent's harness_chain.
 *
 * @param {Object} deps - { getRuntime, stmts, db }
 * @param {Object} agent - row from `agents` table
 * @param {Object} ctx - { message, model? } passed to runtime.buildCommand
 * @param {Object} options - { timeout?, replayTurns? }
 * @returns {Promise<{ status, harness, stdout, stderr, attempts, replayed }>}
 */
async function executeWithFailover(deps, agent, ctx, options) {
  options = options || {};
  const { getRuntime, stmts } = deps;
  let chain;
  try { chain = JSON.parse(agent.harness_chain || '["openclaw"]'); }
  catch { chain = [agent.current_harness || 'openclaw']; }
  if (!Array.isArray(chain) || chain.length === 0) chain = ['openclaw'];

  // Start from the current_harness if it's in the chain; otherwise from the first entry.
  const startIdx = Math.max(0, chain.indexOf(agent.current_harness));
  const ordered = chain.slice(startIdx).concat(chain.slice(0, startIdx));

  const replayTurns = typeof options.replayTurns === 'number' ? options.replayTurns : 10;
  const recent = stmts.getRecentAgentMessages.all(agent.id, replayTurns).reverse();
  const replayContext = recent.length
    ? '\n\n[CONTEXT — last ' + recent.length + ' turns from prior harness]\n'
      + recent.map((m) => '<' + m.role + '> ' + m.content).join('\n')
    : '';

  const attempts = [];
  for (let i = 0; i < ordered.length; i++) {
    const harness = ordered[i];
    let runtime;
    try { runtime = getRuntime(harness); }
    catch { attempts.push({ harness, status: 'unknown-harness' }); continue; }

    const fullMessage = i === 0 ? ctx.message : ctx.message + replayContext;
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
      return Object.assign({}, result, { attempts, replayed: i > 0 ? replayTurns : 0 });
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
