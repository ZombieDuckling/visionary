// Cursor CLI adapter. Expects `cursor-agent` on PATH (Cursor's headless agent).
// If your Cursor binary is named differently, override via CURSOR_BIN env var.

const { execFile } = require('node:child_process');

const NAME = 'cursor';
const BIN = process.env.CURSOR_BIN || 'cursor-agent';

function buildCommand(ctx) {
  return { bin: BIN, args: ['--message', ctx.message] };
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
    execFile(BIN, ['--version'], { timeout: 3000 }, (err, stdout) => {
      if (err) {
        resolve({ ok: false, runtime: NAME, error: err.code === 'ENOENT' ? 'not-installed' : err.message });
      } else {
        resolve({ ok: true, runtime: NAME, version: String(stdout || '').trim() });
      }
    });
  });
}

module.exports = { name: NAME, buildCommand, dispatch, kill, healthcheck };
