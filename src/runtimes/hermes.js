const { execFile } = require('node:child_process');

function buildCommand(ctx) {
  return {
    bin: 'hermes',
    args: ['--yolo', 'chat', '-q', ctx.message, '--toolsets', 'terminal,file,web,browser,cronjob', '--source', 'visionary']
  };
}

function dispatch(ctx, options, callback) {
  const cmd = buildCommand(ctx);
  return execFile(cmd.bin, cmd.args, options, callback);
}

function kill(child) { if (child && !child.killed) child.kill('SIGTERM'); }
function healthcheck() { return { ok: true, command: 'hermes --yolo chat -q <prompt>' }; }
module.exports = { name: 'hermes', buildCommand, dispatch, kill, healthcheck };
