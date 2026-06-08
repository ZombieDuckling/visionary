const { execFile } = require('node:child_process');

function buildCommand(ctx) {
  return {
    bin: 'openclaw',
    args: ['agent', '--local', '--agent', ctx.agentId, '--message', ctx.message, '--json', '--timeout', '600']
  };
}

function dispatch(ctx, options, callback) {
  const cmd = buildCommand(ctx);
  return execFile(cmd.bin, cmd.args, options, callback);
}

function kill(child) {
  if (child && !child.killed) child.kill('SIGTERM');
}

function healthcheck() {
  return { ok: true, command: 'openclaw agent --local --agent <id>' };
}

module.exports = { name: 'openclaw', buildCommand, dispatch, kill, healthcheck };
