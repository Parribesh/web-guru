#!/bin/bash

# Script to create a session and monitor embedding status in real-time

CLI_PORT=9876
CLI_HOST=127.0.0.1
URL="${1:-https://wikipedia.com/wiki/nepal}"

echo "=========================================="
echo "Session Creation & Status Monitor"
echo "=========================================="
echo "URL: $URL"
echo ""

# Function to send CLI command
send_command() {
    local command="$1"
    echo "$command" | nc -w 2 $CLI_HOST $CLI_PORT 2>/dev/null || echo '{"success":false,"error":"Connection failed"}'
}

# Check if app is running
echo "Checking if app is running..."
response=$(send_command '{"type":"list-sessions"}')
if echo "$response" | grep -q "Connection failed\|ECONNREFUSED"; then
    echo "❌ App is not running! Please start it with: npm run dev:start"
    exit 1
fi
echo "✅ App is running"
echo ""

# Create session
echo "Creating session with URL: $URL"
session_response=$(send_command "{\"type\":\"create-session\",\"url\":\"$URL\"}")
echo "$session_response" | jq -r '.data // .error' 2>/dev/null || echo "$session_response"
echo ""

# Extract session ID
session_id=$(echo "$session_response" | jq -r '.data' 2>/dev/null | grep -oP 'Session created: \K[^\s]+' || echo "")

if [ -z "$session_id" ]; then
    echo "❌ Failed to create session or extract session ID"
    exit 1
fi

echo "Session ID: $session_id"
echo ""
echo "Monitoring embedding service status..."
echo "Press Ctrl+C to stop"
echo ""

# Monitor status every 2 seconds
while true; do
    clear
    echo "=========================================="
    echo "Session: $session_id"
    echo "URL: $URL"
    echo "Time: $(date '+%H:%M:%S')"
    echo "=========================================="
    echo ""
    
    # Check embedding service status
    echo "📊 Embedding Service Status:"
    embedding_status=$(send_command '{"type":"embedding-service-status"}')
    echo "$embedding_status" | jq '.' 2>/dev/null || echo "$embedding_status"
    echo ""
    
    # Check chunks
    echo "📦 Chunks:"
    chunks_response=$(send_command "{\"type\":\"get-chunks\",\"sessionId\":\"$session_id\"}")
    echo "$chunks_response" | jq -r '.data // .error' 2>/dev/null || echo "$chunks_response"
    echo ""
    
    sleep 2
done

