#!/bin/bash
# Helper script to create a session from terminal
# Usage: ./create-session.sh [url] [initial-message]

COMMAND_FILE="app-command.json"
URL="${1:-}"
MESSAGE="${2:-}"

# Create command JSON
if [ -n "$URL" ] && [ -n "$MESSAGE" ]; then
  echo "{\"type\":\"create-session\",\"url\":\"$URL\",\"initialMessage\":\"$MESSAGE\"}" > "$COMMAND_FILE"
elif [ -n "$URL" ]; then
  echo "{\"type\":\"create-session\",\"url\":\"$URL\"}" > "$COMMAND_FILE"
else
  echo "{\"type\":\"create-session\"}" > "$COMMAND_FILE"
fi

echo "✅ Command written to $COMMAND_FILE"
echo "   Waiting for app to process..."

