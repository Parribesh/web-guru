#!/usr/bin/env node

/**
 * Create a session and monitor embedding status in real-time
 */

const net = require('net');

const CLI_PORT = 9876;
const CLI_HOST = '127.0.0.1';
const URL = process.argv[2] || 'https://wikipedia.com/wiki/nepal';

function sendCommand(command) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let responseData = '';
    let timeout;

    socket.on('connect', () => {
      socket.write(JSON.stringify(command) + '\n');
    });

    socket.on('data', (data) => {
      responseData += data.toString();
      if (responseData.includes('\n')) {
        clearTimeout(timeout);
        socket.destroy();
        try {
          const response = JSON.parse(responseData.trim());
          resolve(response);
        } catch (e) {
          resolve({ success: false, error: 'Invalid JSON response', raw: responseData });
        }
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      socket.destroy();
      reject(err);
    });

    timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Connection timeout'));
    }, 5000);

    socket.connect(CLI_PORT, CLI_HOST);
  });
}

async function main() {
  console.log('='.repeat(60));
  console.log('Session Creation & Embedding Status Monitor');
  console.log('='.repeat(60));
  console.log(`URL: ${URL}\n`);

  // Check if app is running
  try {
    console.log('Checking if app is running...');
    const listResponse = await sendCommand({ type: 'list-sessions' });
    console.log('✅ App is running\n');
  } catch (error) {
    console.error('❌ App is not running!');
    console.error('   Please start it with: npm run dev:start');
    process.exit(1);
  }

  // Create session
  console.log(`Creating session with URL: ${URL}`);
  let sessionId = null;
  try {
    const createResponse = await sendCommand({ type: 'create-session', url: URL });
    if (createResponse.success) {
      console.log(createResponse.data);
      // Extract session ID from response
      const match = createResponse.data.match(/Session created: ([^\s]+)/);
      if (match) {
        sessionId = match[1];
        console.log(`\n✅ Session created: ${sessionId}\n`);
      } else {
        console.error('❌ Could not extract session ID from response');
        process.exit(1);
      }
    } else {
      console.error(`❌ Failed to create session: ${createResponse.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`❌ Error creating session: ${error.message}`);
    process.exit(1);
  }

  // Monitor status
  console.log('Monitoring embedding service status...');
  console.log('Press Ctrl+C to stop\n');

  let iteration = 0;
  const monitor = setInterval(async () => {
    iteration++;
    const timestamp = new Date().toLocaleTimeString();
    
    // Clear screen (works in most terminals)
    if (iteration > 1) {
      process.stdout.write('\x1B[2J\x1B[0f');
    }

    console.log('='.repeat(60));
    console.log(`Session: ${sessionId} | Time: ${timestamp} | Iteration: ${iteration}`);
    console.log('='.repeat(60));
    console.log();

    // Check embedding service status
    try {
      const embeddingStatus = await sendCommand({ type: 'embedding-service-status' });
      console.log('📊 Embedding Service Status:');
      if (embeddingStatus.success) {
        const status = embeddingStatus.data;
        console.log(`   Available: ${status.available ? '✅ Yes' : '❌ No'}`);
        console.log(`   Base URL: ${status.baseUrl}`);
        console.log(`   Pending Tasks: ${status.pendingTasks}`);
        console.log(`   Socket Connected: ${status.socketConnected ? '✅ Yes' : '❌ No'}`);
      } else {
        console.log(`   Error: ${embeddingStatus.error}`);
      }
    } catch (error) {
      console.log(`   Error: ${error.message}`);
    }
    console.log();

    // Check chunks
    try {
      const chunksResponse = await sendCommand({ type: 'get-chunks', sessionId });
      console.log('📦 Chunks:');
      if (chunksResponse.success) {
        console.log(chunksResponse.data);
      } else {
        console.log(`   ${chunksResponse.error}`);
      }
    } catch (error) {
      console.log(`   Error: ${error.message}`);
    }
    console.log();

  }, 2000); // Update every 2 seconds

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n\nStopping monitor...');
    clearInterval(monitor);
    process.exit(0);
  });
}

main().catch(console.error);

