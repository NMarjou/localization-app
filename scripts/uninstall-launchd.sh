#!/usr/bin/env bash
# Remove both launchd agents (service and ngrok).
set -euo pipefail

for LABEL in com.nolwenn.localization-service com.nolwenn.localization-ngrok; do
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  if [[ -f "$PLIST" ]]; then
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Uninstalled $LABEL"
  else
    echo "Not installed: $PLIST"
  fi
done
