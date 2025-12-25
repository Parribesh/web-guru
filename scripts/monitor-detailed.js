#!/usr/bin/env node

/**
 * Detailed monitoring script that shows embedding generation progress
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
  console.log('='.repeat(70));
  console.log('📊 Detailed Embedding Service Monitor');
  console.log('='.repeat(70));
  console.log(`URL: ${URL}\n`);

  // Check if app is running
  try {
    await sendCommand({ type: 'list-sessions' });
    console.log('✅ App is running\n');
  } catch (error) {
    console.error('❌ App is not running!');
    console.error('   Please start it with: npm run dev:start');
    process.exit(1);
  }

  // Create session
  console.log(`📝 Creating session with URL: ${URL}`);
  let sessionId = null;
  try {
    const createResponse = await sendCommand({ type: 'create-session', url: URL });
    if (createResponse.success) {
      const match = createResponse.data.match(/Session created: ([^\s]+)/);
      if (match) {
        sessionId = match[1];
        console.log(`✅ Session created: ${sessionId}\n`);
      } else {
        console.error('❌ Could not extract session ID');
        process.exit(1);
      }
    } else {
      console.error(`❌ Failed: ${createResponse.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }

  console.log('🔍 Monitoring embedding service status...');
  console.log('   (Watch for embedding generation to start)\n');
  console.log('Press Ctrl+C to stop\n');

  let iteration = 0;
  let lastChunkCount = 0;
  let lastPendingTasks = 0;

  const monitor = setInterval(async () => {
    iteration++;
    const timestamp = new Date().toLocaleTimeString();
    
    if (iteration > 1) {
      process.stdout.write('\x1B[2J\x1B[0f');
    }

    console.log('='.repeat(70));
    console.log(`⏰ ${timestamp} | Iteration: ${iteration}`);
    console.log('='.repeat(70));
    console.log();

    // Embedding Service Status
    try {
      const embeddingStatus = await sendCommand({ type: 'embedding-service-status' });
      console.log('📊 Embedding Service:');
      if (embeddingStatus.success && typeof embeddingStatus.data === 'object') {
        const status = embeddingStatus.data;
        console.log(`   Available: ${status.available ? '✅ YES' : '❌ NO'}`);
        console.log(`   Base URL: ${status.baseUrl || 'N/A'}`);
        console.log(`   Pending Tasks: ${status.pendingTasks || 0}`);
        if (status.pendingTasks !== lastPendingTasks) {
          const diff = status.pendingTasks - lastPendingTasks;
          console.log(`   ${diff > 0 ? '📈' : '📉'} Tasks changed: ${diff > 0 ? '+' : ''}${diff}`);
        }
        lastPendingTasks = status.pendingTasks || 0;
        console.log(`   Socket: ${status.socketConnected ? '✅ Connected' : '❌ Disconnected'}`);
      } else if (embeddingStatus.success && typeof embeddingStatus.data === 'string') {
        console.log(embeddingStatus.data);
      } else {
        console.log(`   Error: ${embeddingStatus.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.log(`   Error: ${error.message}`);
    }
    console.log();

    // Chunks Status
    try {
      const chunksResponse = await sendCommand({ type: 'get-chunks', sessionId });
      console.log('📦 Chunks:');
      if (chunksResponse.success) {
        const data = chunksResponse.data;
        if (typeof data === 'string') {
          console.log(data);
          // Try to extract chunk count
          const match = data.match(/Total chunks: (\d+)/);
          if (match) {
            const currentChunks = parseInt(match[1]);
            if (currentChunks !== lastChunkCount) {
              console.log(`   ${currentChunks > lastChunkCount ? '📈' : '📉'} Chunk count changed: ${lastChunkCount} → ${currentChunks}`);
            }
            lastChunkCount = currentChunks;
          }
        } else {
          console.log(JSON.stringify(data, null, 2));
        }
      } else {
        console.log(`   ${chunksResponse.error || 'No chunks yet'}`);
      }
    } catch (error) {
      console.log(`   Error: ${error.message}`);
    }
    console.log();

    // Analysis
    console.log('💡 Analysis:');
    if (lastPendingTasks > 0) {
      console.log(`   ⚠️  ${lastPendingTasks} tasks pending - embeddings are being processed`);
    } else if (lastChunkCount > 0) {
      console.log(`   ℹ️  ${lastChunkCount} chunks extracted, waiting for embeddings...`);
    }
    console.log();

  }, 2000);

  process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping monitor...');
    clearInterval(monitor);
    process.exit(0);
  });
}

main().catch(console.error);

