#!/usr/bin/env bash
# Install the localisation service AND ngrok tunnel as launchd agents.
# Both start at login, auto-restart on crash, and log to ./logs/.
#
# Optional env vars:
#   NODE_BIN      path to node (default: `which node`)
#   NGROK_BIN     path to ngrok (default: `which ngrok`)
#   NGROK_DOMAIN  static ngrok domain (e.g. countable-robotics-climate.ngrok-free.dev)
#                 If unset, ngrok uses a random auto-assigned URL — and
#                 you'll need to update Lokalise every restart.
set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"

SERVICE_LABEL="com.nolwenn.localization-service"
NGROK_LABEL="com.nolwenn.localization-ngrok"
SERVICE_PLIST="$HOME/Library/LaunchAgents/$SERVICE_LABEL.plist"
NGROK_PLIST="$HOME/Library/LaunchAgents/$NGROK_LABEL.plist"

NODE_BIN="${NODE_BIN:-$(command -v node)}"
if [[ -z "$NODE_BIN" ]]; then
  echo "Could not find node. Set NODE_BIN=/path/to/node and retry." >&2
  exit 1
fi
NGROK_BIN="${NGROK_BIN:-$(command -v ngrok)}"
if [[ -z "$NGROK_BIN" ]]; then
  echo "Could not find ngrok. Set NGROK_BIN=/path/to/ngrok and retry." >&2
  exit 1
fi

mkdir -p "$PROJECT_DIR/logs"
mkdir -p "$HOME/Library/LaunchAgents"

echo "Building TypeScript..."
npm run build

# --- Service (node) ---------------------------------------------------------
sed \
  -e "s|NODE_PATH|$NODE_BIN|g" \
  -e "s|WORKING_DIR|$PROJECT_DIR|g" \
  "$PROJECT_DIR/scripts/$SERVICE_LABEL.plist.template" > "$SERVICE_PLIST"

launchctl unload "$SERVICE_PLIST" 2>/dev/null || true
launchctl load "$SERVICE_PLIST"

# --- ngrok ------------------------------------------------------------------
# Template hardcodes --domain=countable-robotics-climate.ngrok-free.dev; if you
# passed NGROK_DOMAIN override it, and if you don't want a static domain,
# strip the flag.
NGROK_TEMPLATE="$PROJECT_DIR/scripts/$NGROK_LABEL.plist.template"
RENDERED_NGROK=$(sed \
  -e "s|NGROK_PATH|$NGROK_BIN|g" \
  -e "s|WORKING_DIR|$PROJECT_DIR|g" \
  "$NGROK_TEMPLATE")

if [[ -n "${NGROK_DOMAIN:-}" ]]; then
  RENDERED_NGROK=$(echo "$RENDERED_NGROK" | sed \
    -e "s|countable-robotics-climate.ngrok-free.dev|$NGROK_DOMAIN|g")
elif [[ "${NGROK_DOMAIN:-unset}" == "" ]]; then
  # NGROK_DOMAIN was explicitly set to empty string: drop the --url flag.
  RENDERED_NGROK=$(echo "$RENDERED_NGROK" | grep -v '\-\-url=')
fi

echo "$RENDERED_NGROK" > "$NGROK_PLIST"

launchctl unload "$NGROK_PLIST" 2>/dev/null || true
launchctl load "$NGROK_PLIST"

echo
echo "Installed $SERVICE_LABEL and $NGROK_LABEL"
echo "  plists: $SERVICE_PLIST"
echo "          $NGROK_PLIST"
echo "  logs:   $PROJECT_DIR/logs/service.{out,err}.log"
echo "          $PROJECT_DIR/logs/ngrok.{out,err}.log"
echo
echo "Useful commands:"
echo "  launchctl list | grep localization            # verify both running"
echo "  tail -f $PROJECT_DIR/logs/service.out.log      # app logs"
echo "  tail -f $PROJECT_DIR/logs/ngrok.out.log        # ngrok logs"
echo "  launchctl kickstart -k gui/\$(id -u)/$SERVICE_LABEL  # restart app"
echo "  launchctl kickstart -k gui/\$(id -u)/$NGROK_LABEL    # restart ngrok"
