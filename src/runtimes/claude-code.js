const { execFile } = require('node:child_process');

function buildCommand(ctx) {
  return { bin: 'claude', args: ['-p', ctx.message, '--max-turns', '5'] };
}

function dispatch(ctx, options, callback) {
  const cmd = buildCommand(ctx);
  return execFile(cmd.bin, cmd.args, options, callback);
}

function kill(child) { if (child && !child.killed) child.kill('SIGTERM'); }
function healthcheck() { return { ok: true, command: 'claude -p <prompt>' }; }
module.exports = { name: 'claude', aliases: ['claude-code'], buildCommand, dispatch, kill, healthcheck };
