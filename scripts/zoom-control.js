const CDP = require('chrome-remote-interface');
const fs = require('fs');
const path = require('path');

async function resetZoom() {
  try {
    console.log('Attempting to connect to Electron app...');

    // Try different possible DevTools ports
    const ports = [9229, 9222, 9223];
    let client = null;

    for (const port of ports) {
      try {
        console.log(`Trying port ${port}...`);
        client = await CDP({ port });
        break;
      } catch (e) {
        console.log(`Port ${port} failed, trying next...`);
      }
    }

    if (!client) {
      throw new Error('Could not connect to any DevTools port');
    }

    // Get the main page target
    const { Page, Runtime } = client;

    // Enable domains
    await Page.enable();
    await Runtime.enable();

    console.log('✅ Connected to Electron app via DevTools');

    // Execute JavaScript to trigger zoom reset
    console.log('🔧 Executing zoom reset...');
    const result = await Runtime.evaluate({
      expression: `
        if (window.electronAPI && window.electronAPI.zoom && window.electronAPI.zoom.reset) {
          window.electronAPI.zoom.reset();
          '✅ Zoom reset triggered successfully';
        } else {
          '❌ electronAPI.zoom.reset not available. Available APIs: ' + JSON.stringify(Object.keys(window));
        }
      `,
      returnByValue: true
    });

    console.log('📊 Result:', result.result.value);

    // Close the connection
    await client.close();
    console.log('🔌 Disconnected from DevTools');

  } catch (error) {
    console.error('❌ Failed to connect to Electron app:', error.message);
    console.log('\n🔧 To fix this:');
    console.log('1. Enable DevTools in your Electron app');
    console.log('2. Make sure the app is running');
    console.log('3. Try running this script again');
  }
}

// Run the zoom reset
resetZoom();
