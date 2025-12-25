// Quick test script to verify embedding service connection
const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE_URL = process.env.EMBEDDING_SERVICE_URL || 'http://localhost:8000';

async function healthCheck() {
  return new Promise((resolve) => {
    const fullUrl = `${BASE_URL}/health`;
    console.log(`[Health Check] Testing: ${fullUrl}`);
    const urlObj = new URL(fullUrl);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + (urlObj.search || ''),
      method: 'GET',
      timeout: 5000,
    };

    const client = urlObj.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const isHealthy = res.statusCode === 200;
        console.log(`[Health Check] Status: ${res.statusCode} (${isHealthy ? 'OK' : 'FAILED'})`);
        console.log(`[Health Check] Response: ${data}`);
        resolve(isHealthy);
      });
    });

    req.on('error', (error) => {
      console.error(`[Health Check] Error: ${error.message}`);
      resolve(false);
    });

    req.on('timeout', () => {
      console.error('[Health Check] Timeout');
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

async function submitTask() {
  return new Promise((resolve, reject) => {
    const fullUrl = `${BASE_URL}/api/embeddings/task`;
    console.log(`[Submit Task] Testing: ${fullUrl}`);
    
    const requestData = {
      chunk_id: 'test-chunk-1',
      text: 'This is a test text for embedding generation',
    };

    const urlObj = new URL(fullUrl);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + (urlObj.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    };

    console.log(`[Submit Task] Options:`, JSON.stringify(options, null, 2));
    console.log(`[Submit Task] Body:`, JSON.stringify(requestData, null, 2));

    const client = urlObj.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log(`[Submit Task] Status: ${res.statusCode}`);
        console.log(`[Submit Task] Response: ${data}`);
        if (res.statusCode === 200 || res.statusCode === 201) {
          try {
            const response = JSON.parse(data);
            if (response.task_id) {
              console.log(`[Submit Task] Success! Task ID: ${response.task_id}`);
              resolve(response.task_id);
            } else {
              reject(new Error('Invalid response: missing task_id'));
            }
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error(`[Submit Task] Error: ${error.message}`);
      console.error(`[Submit Task] Stack: ${error.stack}`);
      reject(error);
    });

    req.on('timeout', () => {
      console.error('[Submit Task] Timeout');
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(JSON.stringify(requestData));
    req.end();
  });
}

async function main() {
  console.log('='.repeat(60));
  console.log('Embedding Service Connection Test');
  console.log('='.repeat(60));
  console.log(`Base URL: ${BASE_URL}\n`);

  // Test health check
  console.log('\n1. Testing Health Check...');
  const isHealthy = await healthCheck();
  
  if (!isHealthy) {
    console.error('\n❌ Health check failed! Service may not be running.');
    console.error(`   Make sure the Python service is running at ${BASE_URL}`);
    process.exit(1);
  }

  // Test task submission
  console.log('\n2. Testing Task Submission...');
  try {
    const taskId = await submitTask();
    console.log(`\n✅ Task submitted successfully! Task ID: ${taskId}`);
    console.log('\n✅ All tests passed!');
  } catch (error) {
    console.error(`\n❌ Task submission failed: ${error.message}`);
    process.exit(1);
  }
}

main().catch(console.error);

