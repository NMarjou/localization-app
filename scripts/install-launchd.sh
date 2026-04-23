#!/usr/bin/env bash
# Install the localisation service as a launchd agent on macOS.
# Runs at login, auto-restarts on crash, logs to ./logs/.
set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"
LABEL="com.nolwenn.localization-service"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
TEMPLATE="$PROJECT_DIR/scripts/$LABEL.plist.template"

NODE_BIN="${NODE_BIN:-$(command -v node)}"
if [[ -z "$NODE_BIN" ]]; then
  echo "Could not find node. Set NODE_BIN=/path/to/node and retry." >&2
  exit 1
fi

mkdir -p "$PROJECT_DIR/logs"
mkdir -p "$HOME/Library/LaunchAgents"

# Build from source so dist/ is fresh.
echo "Building TypeScript..."
npm run build

# Render the template.
sed \
  -e "s|NODE_PATH|$NODE_BIN|g" \
  -e "s|WORKING_DIR|$PROJECT_DIR|g" \
  "$TEMPLATE" > "$PLIST"

# Unload if already installed, then load fresh.
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo
echo "Installed $LABEL"
echo "  plist:  $PLIST"
echo "  logs:   $PROJECT_DIR/logs/service.{out,err}.log"
echo
echo "Useful commands:"
echo "  tail -f $PROJECT_DIR/logs/service.out.log   # live logs"
echo "  launchctl list | grep localization          # verify running"
echo "  launchctl unload $PLIST                     # stop + disable"
echo "  launchctl load $PLIST                       # start"
echo "  launchctl kickstart -k gui/\$(id -u)/$LABEL  # force restart"
