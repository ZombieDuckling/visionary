#!/usr/bin/env bash
# Visionary Mission Control — launchd service installer.
#
# Generates ~/Library/LaunchAgents/ai.visionary.server.plist and
# ai.visionary.watchdog.plist from the current machine's paths, then
# bootstraps both services under the current user's GUI session.
#
# Idempotent — safe to re-run; existing services are booted out first.
#
#   bash scripts/install-launchd.sh
set -euo pipefail

REPO=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd)
AGENTS_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/.visionary"
GUI_UID=$(id -u)

bold() { printf '\033[1m%s\033[0m\n' "$*"; }

bold "Visionary launchd installer"

# ── resolve binaries ───────────────────────────────────────────────────────────
NODE_BIN=$(command -v node 2>/dev/null || true)
if [ -z "$NODE_BIN" ]; then
  echo "error: node not found on PATH — install Node 20+ first." >&2
  exit 1
fi

PYTHON3_BIN=$(command -v python3 2>/dev/null || true)
if [ -z "$PYTHON3_BIN" ]; then
  echo "error: python3 not found on PATH — install Python 3 first." >&2
  exit 1
fi

# Node bin dir so harness CLIs resolve inside the plist's restricted PATH
NODE_BIN_DIR=$(dirname "$NODE_BIN")

# Build the PATH string: node bindir first, then standard locations
PLIST_PATH="${NODE_BIN_DIR}:${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

echo "  repo       : $REPO"
echo "  node       : $NODE_BIN"
echo "  python3    : $PYTHON3_BIN"
echo "  plist PATH : $PLIST_PATH"

# ── create log dir ─────────────────────────────────────────────────────────────
mkdir -p "$LOG_DIR"
echo "✓ log dir $LOG_DIR"

# ── helpers ────────────────────────────────────────────────────────────────────
# bootout a service, ignoring errors (it may not be loaded)
_bootout() {
  launchctl bootout "gui/${GUI_UID}/$1" 2>/dev/null || true
}

# bootstrap a plist
_bootstrap() {
  launchctl bootstrap "gui/${GUI_UID}" "$1"
}

# ── server plist ───────────────────────────────────────────────────────────────
SERVER_PLIST="$AGENTS_DIR/ai.visionary.server.plist"
cat > "$SERVER_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ai.visionary.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_BIN}</string>
        <string>server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${REPO}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${PLIST_PATH}</string>
        <key>HOME</key>
        <string>${HOME}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/server.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/server.log</string>
</dict>
</plist>
PLIST
echo "✓ wrote $SERVER_PLIST"

# ── watchdog plist ─────────────────────────────────────────────────────────────
WATCHDOG_PLIST="$AGENTS_DIR/ai.visionary.watchdog.plist"
cat > "$WATCHDOG_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ai.visionary.watchdog</string>
    <key>ProgramArguments</key>
    <array>
        <string>${PYTHON3_BIN}</string>
        <string>watchdog.py</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${REPO}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${HOME}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/watchdog.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/watchdog.log</string>
</dict>
</plist>
PLIST
echo "✓ wrote $WATCHDOG_PLIST"

# ── load services ──────────────────────────────────────────────────────────────
echo "Bootstrapping services (bootout first to ensure idempotency)…"

_bootout "ai.visionary.server"
_bootstrap "$SERVER_PLIST"
echo "✓ ai.visionary.server loaded"

_bootout "ai.visionary.watchdog"
_bootstrap "$WATCHDOG_PLIST"
echo "✓ ai.visionary.watchdog loaded"

bold "Done."
echo "  tail -f $LOG_DIR/server.log"
echo "  tail -f $LOG_DIR/watchdog.log"
echo "  launchctl list | grep visionary"
