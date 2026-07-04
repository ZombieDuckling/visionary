#!/usr/bin/env bash
# Visionary Mission Control — launchd service uninstaller.
#
# Boots out ai.visionary.server and ai.visionary.watchdog and removes
# their plists from ~/Library/LaunchAgents/.
#
#   bash scripts/uninstall-launchd.sh
set -euo pipefail

AGENTS_DIR="$HOME/Library/LaunchAgents"
GUI_UID=$(id -u)

bold() { printf '\033[1m%s\033[0m\n' "$*"; }

bold "Visionary launchd uninstaller"

SERVER_PLIST="$AGENTS_DIR/ai.visionary.server.plist"
WATCHDOG_PLIST="$AGENTS_DIR/ai.visionary.watchdog.plist"

# bootout — ignore errors if the service was never loaded
launchctl bootout "gui/${GUI_UID}/ai.visionary.server" 2>/dev/null \
  && echo "✓ ai.visionary.server unloaded" \
  || echo "– ai.visionary.server was not loaded (skipping)"

launchctl bootout "gui/${GUI_UID}/ai.visionary.watchdog" 2>/dev/null \
  && echo "✓ ai.visionary.watchdog unloaded" \
  || echo "– ai.visionary.watchdog was not loaded (skipping)"

# remove plists
if [ -f "$SERVER_PLIST" ]; then
  rm "$SERVER_PLIST"
  echo "✓ removed $SERVER_PLIST"
else
  echo "– $SERVER_PLIST not found (skipping)"
fi

if [ -f "$WATCHDOG_PLIST" ]; then
  rm "$WATCHDOG_PLIST"
  echo "✓ removed $WATCHDOG_PLIST"
else
  echo "– $WATCHDOG_PLIST not found (skipping)"
fi

bold "Done. Services will not restart on next login."
