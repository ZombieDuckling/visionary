const { execFile } = require('node:child_process');
const openclaw = require('./openclaw');
const claude = require('./claude-code');
const hermes = require('./hermes');
const cursor = require('./cursor');
const { executeWithFailover, looksExhausted } = require('./failover');

const registry = new Map();

function normalize(name) {
  return String(name || 'openclaw').trim().toLowerCase();
}

// Shared real healthcheck: probe the actual CLI by running `<bin> --version`.
// Resolves to { ok: true, runtime, version } on success, or
// { ok: false, runtime, error } on failure. ENOENT => 'not-installed'.
function versionHealthcheck(name, bin, args = ['--version']) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 3000 }, (err, stdout) => {
      if (err) {
        resolve({ ok: false, runtime: name, error: err.code === 'ENOENT' ? 'not-installed' : err.message });
      } else {
        resolve({ ok: true, runtime: name, version: String(stdout || '').trim() });
      }
    });
  });
}

function makeSimpleRuntime(name, buildCommand, healthcheck) {
  return {
    name,
    buildCommand,
    dispatch(ctx, options, callback) {
      const cmd = buildCommand(ctx);
      return execFile(cmd.bin, cmd.args, options, callback);
    },
    kill(child) { if (child && !child.killed) child.kill('SIGTERM'); },
    healthcheck: healthcheck || (() => versionHealthcheck(name, name))
  };
}

function registerRuntime(name, runtime) {
  if (!name || !runtime || typeof runtime.buildCommand !== 'function') {
    throw new Error('Runtime must provide a buildCommand(ctx) function');
  }
  const normalized = normalize(name);
  const full = {
    name: runtime.name || normalized,
    buildCommand: runtime.buildCommand,
    dispatch: runtime.dispatch || makeSimpleRuntime(normalized, runtime.buildCommand).dispatch,
    kill: runtime.kill || function (child) { if (child && !child.killed) child.kill('SIGTERM'); },
    healthcheck: runtime.healthcheck || (() => versionHealthcheck(normalized, normalized))
  };
  registry.set(normalized, full);
  (runtime.aliases || []).forEach(alias => registry.set(normalize(alias), full));
  return full;
}

registerRuntime('openclaw', openclaw);
registerRuntime('claude', claude);
registerRuntime('claude-code', claude);
registerRuntime('hermes', hermes);
registerRuntime('cursor', cursor);
registerRuntime('codex', makeSimpleRuntime('codex', ctx => ({ bin: 'codex', args: ['exec', ctx.message, '--skip-git-repo-check'] }), () => versionHealthcheck('codex', 'codex')));
registerRuntime('gemini', makeSimpleRuntime('gemini', ctx => ({ bin: 'gemini', args: ['-p', ctx.message] }), () => versionHealthcheck('gemini', 'gemini')));
registerRuntime('ollama', makeSimpleRuntime('ollama', ctx => ({ bin: 'ollama', args: ['run', ctx.model || 'llama3.2:3b', ctx.message] }), () => versionHealthcheck('ollama', 'ollama')));

function getRuntime(name) {
  const runtime = registry.get(normalize(name));
  if (!runtime) throw new Error('Unknown runtime: ' + name);
  return runtime;
}

function uniqueRuntimes() {
  const seen = new Set();
  return Array.from(registry.entries()).filter(([, rt]) => {
    if (seen.has(rt.name)) return false;
    seen.add(rt.name);
    return true;
  });
}

async function listRuntimes() {
  const entries = uniqueRuntimes();
  const healths = await Promise.all(
    entries.map(([, rt]) => Promise.resolve(rt.healthcheck()))
  );
  return entries.map(([key, rt], i) => ({ id: key, name: rt.name, health: healths[i] }));
}

function listRuntimeIds() {
  return uniqueRuntimes().map(([key]) => key);
}

module.exports = { getRuntime, listRuntimes, listRuntimeIds, registerRuntime, executeWithFailover, looksExhausted };
