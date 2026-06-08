const { execFile } = require('node:child_process');
const openclaw = require('./openclaw');
const claude = require('./claude-code');
const hermes = require('./hermes');

const registry = new Map();

function normalize(name) {
  return String(name || 'openclaw').trim().toLowerCase();
}

function makeSimpleRuntime(name, buildCommand) {
  return {
    name,
    buildCommand,
    dispatch(ctx, options, callback) {
      const cmd = buildCommand(ctx);
      return execFile(cmd.bin, cmd.args, options, callback);
    },
    kill(child) { if (child && !child.killed) child.kill('SIGTERM'); },
    healthcheck() { return { ok: true, runtime: name }; }
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
    healthcheck: runtime.healthcheck || function () { return { ok: true, runtime: normalized }; }
  };
  registry.set(normalized, full);
  (runtime.aliases || []).forEach(alias => registry.set(normalize(alias), full));
  return full;
}

registerRuntime('openclaw', openclaw);
registerRuntime('claude', claude);
registerRuntime('claude-code', claude);
registerRuntime('hermes', hermes);
registerRuntime('codex', makeSimpleRuntime('codex', ctx => ({ bin: 'codex', args: ['exec', ctx.message, '--skip-git-repo-check'] })));
registerRuntime('gemini', makeSimpleRuntime('gemini', ctx => ({ bin: 'gemini', args: ['-p', ctx.message] })));
registerRuntime('ollama', makeSimpleRuntime('ollama', ctx => ({ bin: 'ollama', args: ['run', ctx.model || 'llama3.2:3b', ctx.message] })));

function getRuntime(name) {
  const runtime = registry.get(normalize(name));
  if (!runtime) throw new Error('Unknown runtime: ' + name);
  return runtime;
}

function listRuntimes() {
  const seen = new Set();
  return Array.from(registry.entries()).filter(([, rt]) => {
    if (seen.has(rt.name)) return false;
    seen.add(rt.name);
    return true;
  }).map(([key, rt]) => ({ id: key, name: rt.name, health: rt.healthcheck() }));
}

module.exports = { getRuntime, listRuntimes, registerRuntime };
