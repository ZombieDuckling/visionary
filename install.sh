#!/usr/bin/env bash
# Visionary Mission Control — installer.
#
# Installs dependencies, verifies the native SQLite binding for your Node,
# and puts the `vision` command on your PATH.
#
#   ./install.sh             install + link `vision`
#   ./install.sh --no-link   install only, skip the PATH symlink
set -euo pipefail

REPO=$(cd -P "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
cd "$REPO"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }

bold "Visionary Mission Control — install"

# 1) Node 20+
if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required (Node 20+). Install from https://nodejs.org or via nvm/brew." >&2
  exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "error: Node ${NODE_MAJOR} found — Visionary needs Node 20+." >&2
  exit 1
fi
echo "✓ node $(node -v)"

# 2) npm dependencies (better-sqlite3 is the only runtime dep)
echo "Installing npm dependencies…"
npm install --no-fund --no-audit
echo "✓ npm dependencies"

# 3) Native binding sanity (self-heals an ABI mismatch)
node scripts/ensure-native.js
echo "✓ better-sqlite3 native binding"

# 4) Optional Python extras (agent bridge + watchdog daemons)
if command -v python3 >/dev/null 2>&1; then
  if [ ! -d .venv ]; then
    echo "Setting up optional Python venv (bridge/watchdog)…"
    python3 -m venv .venv 2>/dev/null \
      && .venv/bin/pip install --quiet websockets 2>/dev/null \
      && echo "✓ python extras (.venv)" \
      || echo "– skipped python extras (non-fatal)"
  else
    echo "✓ python venv already present"
  fi
else
  echo "– python3 not found; skipping optional bridge/watchdog extras"
fi

# 5) Link the `vision` command
chmod +x bin/vision
if [ "${1:-}" != "--no-link" ]; then
  BIN_TARGET=""
  for CAND in /usr/local/bin /opt/homebrew/bin "$HOME/.local/bin"; do
    if [ -d "$CAND" ] && [ -w "$CAND" ]; then BIN_TARGET="$CAND"; break; fi
  done
  if [ -z "$BIN_TARGET" ]; then
    BIN_TARGET="$HOME/.local/bin"
    mkdir -p "$BIN_TARGET"
  fi
  ln -sf "$REPO/bin/vision" "$BIN_TARGET/vision"
  echo "✓ linked: $BIN_TARGET/vision -> bin/vision"
  case ":$PATH:" in
    *":$BIN_TARGET:"*) ;;
    *) echo "  note: add $BIN_TARGET to your PATH (e.g. in ~/.zshrc):"
       echo "        export PATH=\"$BIN_TARGET:\$PATH\"" ;;
  esac
fi

# 6) Quick smoke: syntax-check the server
npm run check >/dev/null
echo "✓ server syntax check"

# 7) launchd services (macOS only)
if [[ "${1:-}" == "--launchd" ]]; then
  if [[ "$(uname)" == "Darwin" ]]; then
    bold "Installing launchd services…"
    bash "$REPO/scripts/install-launchd.sh"
  else
    echo "– --launchd flag ignored (not macOS)"
  fi
else
  if [[ "$(uname)" == "Darwin" ]]; then
    echo ""
    echo "  hint: run './install.sh --launchd' to install launchd services"
    echo "        (ai.visionary.server + ai.visionary.watchdog, KeepAlive)"
  fi
fi

bold "Done."
echo "  vision           # open the dashboard (starts the server if needed)"
echo "  vision app       # desktop app (Electron)"
echo "  vision status    # is it running?"
