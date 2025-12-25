#!/usr/bin/env node

/**
 * Test script to verify WebSocket job status events from the backend
 * This script:
 * 1. Submits a batch of embedding tasks to get a jobId
 * 2. Connects to the WebSocket endpoint /ws/job/{job_id}
 * 3. Logs all received events to verify backend is sending jobStatus updates
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const BASE_URL = process.env.EMBEDDING_SERVICE_URL || 'http://127.0.0.1:8000';
const TEST_URL = process.env.TEST_URL || 'https://example.com';

function makeRequest(url, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + (urlObj.search || ''),
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    };

    const client = urlObj.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(responseData);
            resolve({ status: res.statusCode, data: parsed });
          } catch (e) {
            resolve({ status: res.statusCode, data: responseData });
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function submitBatch() {
  console.log('\n📤 Submitting batch of embedding tasks...');
  
  // Generate a jobId (UUID v4)
  const { v4: uuidv4 } = require('uuid');
  const jobId = uuidv4();
  console.log(`   Generated Job ID: ${jobId}`);
  
  // Create a batch with a few chunks
  const chunks = [
    { chunk_id: `test-chunk-${Date.now()}-1`, text: 'This is the first test chunk for embedding generation' },
    { chunk_id: `test-chunk-${Date.now()}-2`, text: 'This is the second test chunk for embedding generation' },
    { chunk_id: `test-chunk-${Date.now()}-3`, text: 'This is the third test chunk for embedding generation' },
  ];

  const batchUrl = `${BASE_URL}/api/embeddings/batch`;
  console.log(`   URL: ${batchUrl}`);
  console.log(`   Chunks: ${chunks.length}`);

  try {
    const response = await makeRequest(batchUrl, 'POST', {
      job_id: jobId,  // Include job_id in the request
      chunks: chunks.map(c => ({
        chunk_id: c.chunk_id,
        text: c.text,
      })),
    });

    console.log(`   ✅ Batch submitted successfully`);
    console.log(`   Response:`, JSON.stringify(response.data, null, 2));

    // Use the jobId we sent (backend should echo it back)
    const returnedJobId = response.data.job_id || jobId;
    if (returnedJobId) {
      return returnedJobId;
    } else {
      throw new Error('No job_id in batch response');
    }
  } catch (error) {
    console.error(`   ❌ Batch submission failed: ${error.message}`);
    throw error;
  }
}

function connectWebSocket(jobId) {
  return new Promise((resolve, reject) => {
    const wsUrl = BASE_URL.replace(/^http/, 'ws') + `/ws/job/${jobId}`;
    console.log(`\n🔌 Connecting to WebSocket: ${wsUrl}`);

    const ws = new WebSocket(wsUrl);
    let connected = false;
    let messageCount = 0;
    const startTime = Date.now();

    ws.on('open', () => {
      connected = true;
      console.log(`   ✅ WebSocket connected!`);
      console.log(`   📡 Waiting for jobStatus events...\n`);
      resolve(ws);
    });

      ws.on('message', (data) => {
      messageCount++;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      
      try {
        const message = typeof data === 'string' ? data : data.toString();
        const jobStatus = JSON.parse(message);
        
        // Backend sends: { type: "job_status_update", payload: { status: {...} } }
        let actualJobStatus = jobStatus;
        if (jobStatus.type === 'job_status_update' && jobStatus.payload && jobStatus.payload.status) {
          actualJobStatus = jobStatus.payload.status;
        } else if (jobStatus.status && typeof jobStatus.status === 'object') {
          actualJobStatus = jobStatus.status;
        }
        
        console.log(`\n📨 [${elapsed}s] Message #${messageCount} received:`);
        console.log(`   Message type: ${jobStatus.type || 'N/A'}`);
        console.log(`   Raw JSON keys:`, Object.keys(actualJobStatus).join(', '));
        
        // Extract job info from the actual status object
        const jobId = actualJobStatus.job_id || actualJobStatus.jobId || 'N/A';
        const status = actualJobStatus.status || 'N/A';
        const totalChunks = actualJobStatus.total_chunks || actualJobStatus.totalChunks || 'N/A';
        const completedChunks = actualJobStatus.completed_chunks || actualJobStatus.completedChunks || 0;
        const totalBatches = actualJobStatus.total_batches || actualJobStatus.totalBatches || 'N/A';
        const completedBatches = actualJobStatus.completed_batches || actualJobStatus.completedBatches || 0;
        
        console.log(`   Extracted Info:`);
        console.log(`      Job ID: ${jobId}`);
        console.log(`      Status: ${status}`);
        console.log(`      Total Chunks: ${totalChunks}`);
        console.log(`      Completed Chunks: ${completedChunks}`);
        console.log(`      Total Batches: ${totalBatches}`);
        console.log(`      Completed Batches: ${completedBatches}`);
        
        const batches = actualJobStatus.batches || actualJobStatus.batch_metrics || [];
        if (batches && batches.length > 0) {
          console.log(`   Batch Details (first 3):`);
          batches.slice(0, 3).forEach((batch, idx) => {
            const batchId = batch.batch_id || batch.batchId || 'N/A';
            const batchStatus = batch.status || 'N/A';
            const completed = batch.completed_count || batch.completedCount || 0;
            const size = batch.batch_size || batch.batchSize || batch.chunks_count || 0;
            console.log(`     Batch ${idx + 1}: ${batchId} - ${batchStatus} (${completed}/${size} chunks)`);
          });
        }

        // Check if job is complete
        if (status === 'completed' || status === 'failed') {
          console.log(`\n   ✅ Job finished with status: ${status}`);
          console.log(`   📊 Final Stats:`);
          console.log(`      - Total Chunks: ${totalChunks}`);
          console.log(`      - Completed: ${completedChunks}`);
          console.log(`      - Failed: ${actualJobStatus.failed_chunks || actualJobStatus.failedChunks || 0}`);
          console.log(`      - Success Rate: ${actualJobStatus.success_rate || actualJobStatus.successRate || 0}%`);
          console.log(`      - Total Messages Received: ${messageCount}`);
          
          // Close connection after a brief delay
          setTimeout(() => {
            ws.close();
            process.exit(0);
          }, 2000);
        }
      } catch (error) {
        console.error(`   ❌ Error parsing message: ${error.message}`);
        console.error(`   Raw message (first 1000 chars):`, message.substring(0, 1000));
      }
    });

    ws.on('error', (error) => {
      console.error(`\n   ❌ WebSocket error: ${error.message}`);
      if (!connected) {
        reject(error);
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`\n   🔌 WebSocket closed (code: ${code}, reason: ${reason || 'none'})`);
      console.log(`   📊 Summary: Received ${messageCount} messages over ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
    });

    // Timeout after 60 seconds if no messages received
    setTimeout(() => {
      if (messageCount === 0) {
        console.error(`\n   ⚠️  No messages received in 60 seconds. Backend may not be sending events.`);
        ws.close();
        process.exit(1);
      }
    }, 60000);
  });
}

async function main() {
  console.log('='.repeat(70));
  console.log('WebSocket Job Status Event Test');
  console.log('='.repeat(70));
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Test URL: ${TEST_URL}\n`);

  try {
    // Step 1: Submit a batch to get a jobId
    const jobId = await submitBatch();
    console.log(`\n✅ Job ID obtained: ${jobId}`);

    // Step 2: Connect to WebSocket and listen for events
    const ws = await connectWebSocket(jobId);
    
    // Keep the script running until WebSocket closes or job completes
    console.log('\n⏳ Monitoring job progress (will exit when job completes or after 60s)...');
    
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

main().catch(console.error);

