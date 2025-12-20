#!/bin/bash

# Interactive test script to create session and test agent via command line
# This allows real-time testing while watching the UI update

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMAND_FILE="$PROJECT_ROOT/app-command.json"

echo "🤖 Agent Performance Test (Command Line)"
echo "=========================================="
echo ""
echo "This script will:"
echo "  1. Create a session with the dev sample page"
echo "  2. Allow you to ask questions via command line"
echo "  3. Show real-time updates in the UI"
echo ""
echo "Make sure the Electron app is running!"
echo ""

# Get the dev sample file path
DEV_SAMPLE_PATH="$PROJECT_ROOT/app/dev-sample.html"
DEV_SAMPLE_URL="file://$DEV_SAMPLE_PATH"

echo "📄 Step 1: Creating session..."
echo "{\"type\":\"create-session\",\"url\":\"$DEV_SAMPLE_URL\"}" > "$COMMAND_FILE"
echo "✅ Session creation command sent"
echo "⏳ Waiting 5 seconds for session to be created and page to load..."
sleep 5

echo ""
echo "📊 Session should now be visible in the UI"
echo "📊 Wait for embeddings to generate (watch EmbeddingProgress)"
echo "📊 Then you can ask questions below"
echo ""
echo "💡 Test Questions:"
echo "  1. What is the global AI market size in 2024?"
echo "  2. Which sector has the highest adoption rate?"
echo "  3. How much was invested in healthcare AI?"
echo "  4. What is the projected market size by 2028?"
echo "  5. Which region has the most AI companies?"
echo ""
echo "To ask a question, run:"
echo "  echo '{\"type\":\"send-message\",\"sessionId\":\"SESSION_ID\",\"content\":\"YOUR_QUESTION\"}' > app-command.json"
echo ""
echo "Or use the UI chat panel to ask questions interactively!"
echo ""

# Interactive mode - ask for session ID
echo "🔍 To get the session ID, check the console output or UI"
echo "   The session ID will be printed when the session is created"
echo ""
echo "📝 Example command format:"
echo '   echo "{\"type\":\"send-message\",\"sessionId\":\"abc-123\",\"content\":\"What is the global AI market size in 2024?\"}" > app-command.json'
echo ""

