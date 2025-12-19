#!/usr/bin/env node

/**
 * Test script to interact with the AI agent and test queries
 * This script simulates the QA service to test responses
 */

const path = require('path');
const fs = require('fs');

// Test questions to ask
const testQuestions = [
  "What is the global AI market size in 2024?",
  "Which sector has the highest adoption rate?",
  "How much was invested in healthcare AI?",
  "What is the projected market size by 2028?",
  "Which region has the most AI companies?",
  "What percentage of Fortune 500 companies use AI?",
  "What was the market size in 2022?",
  "Which technology category has the highest growth rate?",
];

// First, let's check if we can read the dev sample to verify content
const devSamplePath = path.join(__dirname, 'app/dev-sample.html');
console.log('📄 Checking dev sample file...');
if (fs.existsSync(devSamplePath)) {
  const content = fs.readFileSync(devSamplePath, 'utf-8');
  const wordCount = content.split(/\s+/).length;
  const tableCount = (content.match(/<table/g) || []).length;
  console.log(`✅ Dev sample found: ${wordCount} words, ${tableCount} tables\n`);
} else {
  console.log('❌ Dev sample not found at:', devSamplePath);
  process.exit(1);
}

console.log('🧪 Test Questions to Verify:\n');
testQuestions.forEach((q, i) => {
  console.log(`${i + 1}. ${q}`);
});

console.log('\n📝 Instructions:');
console.log('1. Make sure the Electron app is running');
console.log('2. Navigate to the dev-sample.html page (should load by default)');
console.log('3. Wait for embeddings to be generated (check EventLog)');
console.log('4. Ask these questions in the chat panel');
console.log('5. Check the responses and EventLog for debugging info\n');

console.log('💡 Expected Answers:');
console.log('1. $184.7 billion');
console.log('2. Financial Services with 74.8%');
console.log('3. $34.2 billion');
console.log('4. $422.5 billion');
console.log('5. Asia Pacific with 4,892 companies');
console.log('6. 63.5%');
console.log('7. $136.8 billion');
console.log('8. Natural Language Processing with 42.7%\n');

console.log('🔍 Debugging Tips:');
console.log('- Check EventLog for table extraction count');
console.log('- Look for chunks marked with 📊 (table data)');
console.log('- Verify similarity scores are different (not all 20.1%)');
console.log('- Check if numerical query detection is working');
console.log('- Verify chunks contain actual table data\n');

// Try to check if Ollama is running
const http = require('http');
console.log('🔌 Checking Ollama connection...');
const checkOllama = () => {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:11434/api/tags', { timeout: 2000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
};

checkOllama().then(isRunning => {
  if (isRunning) {
    console.log('✅ Ollama is running\n');
  } else {
    console.log('⚠️  Ollama is not running. Start it with: ollama serve\n');
  }
  
  console.log('🚀 Ready to test! Open the app and try the questions above.\n');
});

