// Cookbook — model discovery per harness.
//
// Adapted from odysseus's model_discovery pattern. Each harness gets a list of
// known model IDs plus an optional runtime probe (e.g. `ollama list`). The
// result powers the Settings → Available Models panel and gives agents
// something to pick from when overriding their default model.

const { execFile } = require('node:child_process');

// Known/curated models per harness. Updated when providers ship new ones.
const STATIC_MODELS = {
  claude: [
    { id: 'claude-opus-4-7',   tier: 'flagship', context: 200000 },
    { id: 'claude-sonnet-4-6', tier: 'balanced', context: 200000 },
    { id: 'claude-haiku-4-5',  tier: 'fast',     context: 200000 }
  ],
  'claude-code': [
    { id: 'claude-opus-4-7',   tier: 'flagship', context: 200000 },
    { id: 'claude-sonnet-4-6', tier: 'balanced', context: 200000 }
  ],
  codex: [
    { id: 'gpt-5.5',      tier: 'flagship', context: 256000 },
    { id: 'gpt-5.5-mini', tier: 'fast',     context: 128000 },
    { id: 'gpt-5-pro',    tier: 'reasoning', context: 256000 }
  ],
  gemini: [
    { id: 'gemini-3.1-pro',   tier: 'flagship', context: 2000000 },
    { id: 'gemini-2.5-flash', tier: 'fast',     context: 1000000 }
  ],
  cursor: [
    { id: 'cursor-default', tier: 'auto-routed', context: 200000 }
  ],
  hermes: [
    { id: 'gpt-5.5',           tier: 'auto-routed', context: 256000 },
    { id: 'claude-sonnet-4-6', tier: 'auto-routed', context: 200000 }
  ]
};

function runProbe(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs || 5000 }, (err, stdout) => {
      if (err) { resolve(null); return; }
      resolve(String(stdout || '').trim());
    });
  });
}

async function probeOllama() {
  // `ollama list` prints: NAME  ID  SIZE  MODIFIED
  const out = await runProbe('ollama', ['list']);
  if (!out) return [];
  const lines = out.split('\n').slice(1); // drop header
  return lines.map((line) => line.split(/\s+/)[0]).filter(Boolean).map((id) => ({
    id, tier: 'local', context: null
  }));
}

async function probeOpenclaw() {
  // openclaw stores its config at ~/.openclaw/config.json — read model list if present.
  const fs = require('node:fs');
  const path = require('node:path');
  const cfg = path.join(process.env.HOME || '.', '.openclaw', 'config.json');
  try {
    const data = JSON.parse(fs.readFileSync(cfg, 'utf-8'));
    const models = (data.models || data.providers || []).map((m) => ({
      id: m.id || m.name || m.model,
      tier: m.tier || 'configured',
      context: m.context || null
    })).filter((m) => m.id);
    return models.length ? models : null;
  } catch { return null; }
}

async function discover(harnessName) {
  const name = String(harnessName || '').toLowerCase();
  if (STATIC_MODELS[name]) return STATIC_MODELS[name];
  if (name === 'ollama') return await probeOllama();
  if (name === 'openclaw') {
    const probed = await probeOpenclaw();
    return probed || [];
  }
  return [];
}

async function inventory(runtimes) {
  // runtimes is an array of { id, name } from listRuntimes()
  const result = {};
  for (const r of runtimes) {
    const harnessName = r.name || r.id;
    result[harnessName] = await discover(harnessName);
  }
  return result;
}

module.exports = { discover, inventory, STATIC_MODELS };
