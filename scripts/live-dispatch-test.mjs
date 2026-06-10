// Live end-to-end capstone: boot a fresh server on a temp DB, open the real SSE
// stream, dispatch a real agent, and confirm output streams back + the run
// persists. Proves the full human path: dispatch -> harness -> stream -> persist.
//
// Usage: node scripts/live-dispatch-test.mjs [agentId] [message]
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const AGENT = process.argv[2] || 'forge';
const MESSAGE = process.argv[3] || 'Reply with exactly the word: pong (and nothing else).';
const PORT = 3411;
const DB = join(mkdtempSync(join(tmpdir(), 'vis-live-')), 'test.sqlite');

function req(method, path, body) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: PORT, path, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (resp) => {
      let buf = ''; resp.on('data', (d) => buf += d); resp.on('end', () => res({ status: resp.statusCode, body: buf }));
    });
    r.on('error', rej); if (data) r.write(data); r.end();
  });
}

const server = spawn(process.execPath, ['server.js'], {
  cwd: repoRoot,
  env: { ...process.env, VISIONARY_PORT: String(PORT), VISIONARY_DB: DB, PATH: process.env.PATH + ':/opt/homebrew/bin:/usr/local/bin' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverErr = '';
server.stderr.on('data', (d) => serverErr += d);

function waitReady() {
  return new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('server did not start\n' + serverErr)), 15000);
    server.stdout.on('data', (d) => { if (/running|listening|:\s*\d+/i.test(String(d))) { clearTimeout(to); res(); } });
    server.on('exit', (c) => { clearTimeout(to); rej(new Error('server exited ' + c + '\n' + serverErr)); });
  });
}

const events = [];
let outputChunks = 0;
let outputSample = '';
let harnessSeen = null;
function openSSE() {
  const r = http.request({ host: '127.0.0.1', port: PORT, path: '/api/events', method: 'GET' }, (resp) => {
    let buf = '';
    resp.on('data', (d) => {
      buf += d;
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const ev = (block.match(/^event:\s*(.*)$/m) || [])[1];
        const dataLine = (block.match(/^data:\s*([\s\S]*)$/m) || [])[1];
        if (!ev) continue;
        events.push(ev);
        if (ev === 'agent:harness') { try { harnessSeen = JSON.parse(dataLine).harness; } catch {} }
        if (ev === 'agent:output') { outputChunks++; try { const c = JSON.parse(dataLine).chunk || ''; if (outputSample.length < 400) outputSample += c; } catch {} }
      }
    });
  });
  r.on('error', () => {});
  r.end();
}

const done = (ok, note) => {
  try { server.kill('SIGTERM'); } catch {}
  console.log('\n--- LIVE DISPATCH RESULT ---');
  console.log('agent:', AGENT, '| event types seen:', [...new Set(events)].join(', ') || '(none)');
  console.log('harness used:', harnessSeen || '(none)', '| agent:output chunks:', outputChunks);
  if (outputSample) console.log('output sample:', JSON.stringify(outputSample.slice(0, 200)));
  console.log(note);
  console.log(ok ? 'CAPSTONE PASS' : 'CAPSTONE INCOMPLETE');
  process.exit(ok ? 0 : 1);
};

await waitReady();
openSSE();
await new Promise((r) => setTimeout(r, 400));

const health = await req('GET', '/api/runtimes');
const disp = await req('POST', '/api/dispatch', { agent_id: AGENT, message: MESSAGE });
console.log('dispatch response:', disp.status, disp.body.slice(0, 200));
let runId = null;
try { runId = JSON.parse(disp.body).run_id; } catch {}

// Poll the run row until terminal, up to 120s (read-only: the server is the writer).
const Database = require('better-sqlite3');
const rodb = new Database(DB, { readonly: true });
const deadline = Date.now() + 120000;
const tick = setInterval(() => {
  let run = null;
  try { run = rodb.prepare('SELECT * FROM agent_runs WHERE id=?').get(runId); } catch {}
  const terminal = run && ['completed', 'failed', 'timeout'].includes(run.status);
  if (terminal || Date.now() > deadline) {
    clearInterval(tick);
    const gotLifecycle = events.includes('agent:started') && (events.includes('agent:completed') || events.includes('agent:failed'));
    const ok = !!(run && run.status === 'completed' && gotLifecycle);
    done(ok, 'run #' + runId + ' final status: ' + (run ? run.status : 'unknown') + (run && run.result_text ? ' | output: ' + JSON.stringify(String(run.result_text).slice(0, 160)) : '') + (run && run.error ? ' | error: ' + JSON.stringify(String(run.error).slice(0, 160)) : ''));
  }
}, 1500);
