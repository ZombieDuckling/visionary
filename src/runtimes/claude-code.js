// Claude Code (`claude -p`) adapter.
//
// Headless `claude -p` blocks on tool-use permission prompts by default, so
// agent dispatches that try to Write/Edit/Bash hang or refuse. This adapter
// accepts per-dispatch overrides:
//
//   ctx.allowedTools                 — array of tool names to allow (default
//                                      Read/Write/Edit/Bash/Glob/Grep/WebFetch)
//   ctx.maxTurns                     — number of agent turns (default 20)
//   ctx.dangerouslySkipPermissions   — true → pass --dangerously-skip-permissions
//                                      and skip the allowedTools flag. Use only
//                                      for trusted local automation.
//
// Server callers can set these via the dispatch route body fields:
//   allowed_tools, max_turns, dangerously_skip_permissions.

const { execFile } = require('node:child_process');

const DEFAULT_ALLOWED_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch'];
const DEFAULT_MAX_TURNS = 20;

function buildCommand(ctx) {
  // JSON output carries usage + total_cost_usd so runs get real cost data.
  const args = ['-p', ctx.message, '--output-format', 'json', '--max-turns', String(ctx.maxTurns || DEFAULT_MAX_TURNS)];
  if (ctx.dangerouslySkipPermissions === true) {
    args.push('--dangerously-skip-permissions');
  } else {
    const tools = Array.isArray(ctx.allowedTools) && ctx.allowedTools.length
      ? ctx.allowedTools
      : DEFAULT_ALLOWED_TOOLS;
    args.push('--allowedTools', tools.join(','));
  }
  return { bin: 'claude', args };
}

function dispatch(ctx, options, callback) {
  const cmd = buildCommand(ctx);
  return execFile(cmd.bin, cmd.args, options, callback);
}

function kill(child) { if (child && !child.killed) child.kill('SIGTERM'); }

function healthcheck() {
  return new Promise((resolve) => {
    execFile('claude', ['--version'], { timeout: 3000 }, (err, stdout) => {
      if (err) {
        resolve({ ok: false, runtime: 'claude', error: err.code === 'ENOENT' ? 'not-installed' : err.message });
      } else {
        resolve({ ok: true, runtime: 'claude', version: String(stdout || '').trim() });
      }
    });
  });
}

module.exports = { name: 'claude', aliases: ['claude-code'], buildCommand, dispatch, kill, healthcheck };
