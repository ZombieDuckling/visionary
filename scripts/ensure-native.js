#!/usr/bin/env node
// Self-healing native-binding preflight for the server/test run path.
//
// better-sqlite3 ships a compiled `.node` addon tied to a specific ABI
// (NODE_MODULE_VERSION). The committed binary may have been built for Electron's
// ABI (via `electron-builder`), which plain `node` cannot load — it fails with
// ERR_DLOPEN_FAILED. This script verifies the binding loads under the CURRENT
// runtime and, if not, rebuilds it once with `npm rebuild better-sqlite3`.
//
// Wired as prestart/predev/presmoke so `npm start` and `npm run verify` work from
// a clean checkout without manual `npm rebuild`. Note: this rebuilds for the node
// ABI. The Electron app (`npm run app` / electron-builder) manages its own native
// rebuild — see package.json `rebuild:node`.

const { execFileSync } = require('node:child_process');
const path = require('node:path');

function tryLoad() {
  // Clear require cache so a post-rebuild retry actually re-loads the addon.
  const resolved = require.resolve('better-sqlite3');
  delete require.cache[resolved];
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.prepare('SELECT 1 AS ok').get();
  db.close();
}

function main() {
  try {
    tryLoad();
    return; // Already good — stay quiet so the run path isn't noisy.
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND') {
      console.error('[ensure-native] better-sqlite3 is not installed. Run: npm install');
      process.exit(1);
    }
    console.error('[ensure-native] better-sqlite3 failed to load (' + (err && err.code || 'unknown') + ').');
    console.error('[ensure-native] Rebuilding for node ' + process.version + ' (NODE_MODULE_VERSION ' + process.versions.modules + ')...');
  }

  try {
    execFileSync('npm', ['rebuild', 'better-sqlite3'], {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    });
  } catch (rebuildErr) {
    console.error('[ensure-native] npm rebuild better-sqlite3 failed: ' + (rebuildErr && rebuildErr.message));
    process.exit(1);
  }

  try {
    tryLoad();
    console.error('[ensure-native] Rebuild succeeded — better-sqlite3 now loads.');
  } catch (err2) {
    console.error('[ensure-native] Still cannot load better-sqlite3 after rebuild: ' + (err2 && err2.message));
    process.exit(1);
  }
}

main();
