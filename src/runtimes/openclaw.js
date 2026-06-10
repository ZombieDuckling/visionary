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
  return new Promise((resolve) => {
    execFile('openclaw', ['--version'], { timeout: 3000 }, (err, stdout) => {
      if (err) {
        resolve({ ok: false, runtime: 'openclaw', error: err.code === 'ENOENT' ? 'not-installed' : err.message });
      } else {
        resolve({ ok: true, runtime: 'openclaw', version: String(stdout || '').trim() });
      }
    });
  });
}

module.exports = { name: 'openclaw', buildCommand, dispatch, kill, healthcheck };
