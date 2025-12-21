#!/bin/bash
# Monitor crash reports in real-time

PROJECT_DIR="/home/stargazer/Work/agent/web-guru"
LOG_FILE="$PROJECT_DIR/crash-reports.log"

# Also check Electron userData directory
ELECTRON_USERDATA="$HOME/.config/electron-ai-browser/crash-reports.log"
if [ -f "$ELECTRON_USERDATA" ]; then
    LOG_FILE="$ELECTRON_USERDATA"
fi

echo "Monitoring crash reports..."
echo "Log file: $LOG_FILE"
echo "Press Ctrl+C to stop"
echo ""

if [ ! -f "$LOG_FILE" ]; then
    echo "Waiting for log file to be created..."
    # Wait for file to be created
    while [ ! -f "$LOG_FILE" ]; do
        sleep 1
    done
    echo "Log file created, starting monitoring..."
fi

# Monitor the file
tail -f "$LOG_FILE" 2>/dev/null || {
    echo "Error: Could not monitor $LOG_FILE"
    echo "Checking if file exists..."
    ls -la "$LOG_FILE" 2>/dev/null || echo "File does not exist yet"
    exit 1
}

