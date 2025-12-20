#!/bin/bash

# Test script to create a session and test agent performance
# This script creates a session with the dev sample page and asks test questions

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMAND_FILE="$PROJECT_ROOT/app-command.json"

echo "🧪 Testing Agent Performance"
echo "=============================="
echo ""

# Get the dev sample file path
DEV_SAMPLE_PATH="$PROJECT_ROOT/app/dev-sample.html"
DEV_SAMPLE_URL="file://$DEV_SAMPLE_PATH"

echo "📄 Dev sample path: $DEV_SAMPLE_PATH"
echo "🌐 Dev sample URL: $DEV_SAMPLE_URL"
echo ""

# Test questions
QUESTIONS=(
  "What is the global AI market size in 2024?"
  "Which sector has the highest adoption rate?"
  "How much was invested in healthcare AI?"
  "What is the projected market size by 2028?"
  "Which region has the most AI companies?"
)

echo "📝 Step 1: Creating session with dev sample page..."
echo "{\"type\":\"create-session\",\"url\":\"$DEV_SAMPLE_URL\"}" > "$COMMAND_FILE"
echo "✅ Command file created: $COMMAND_FILE"
echo "⏳ Waiting for session to be created and page to load..."
echo ""

# Wait a bit for session creation and page load
sleep 3

echo "📊 Step 2: Session should now be visible in the UI"
echo "📊 Step 3: Wait for embeddings to generate (check EmbeddingProgress component)"
echo "📊 Step 4: Then ask these questions in the chat:"
echo ""

for i in "${!QUESTIONS[@]}"; do
  echo "   $((i+1)). ${QUESTIONS[$i]}"
done

echo ""
echo "💡 Expected answers:"
echo "   1. \$184.7 billion"
echo "   2. Financial Services with 74.8%"
echo "   3. \$34.2 billion"
echo "   4. \$422.5 billion"
echo "   5. Asia Pacific with 4,892 companies"
echo ""
echo "✅ Test setup complete!"
echo "📱 Check the UI - you should see:"
echo "   - New session created"
echo "   - Dev sample page loaded"
echo "   - Embedding progress updates"
echo "   - Event log showing all events"
echo ""

