#!/usr/bin/env bash
# Remove the launchd agent (stops the service and disables auto-start).
set -euo pipefail

LABEL="com.nolwenn.localization-service"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [[ -f "$PLIST" ]]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Uninstalled $LABEL"
else
  echo "Not installed: $PLIST"
fi
