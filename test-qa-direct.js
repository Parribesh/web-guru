#!/usr/bin/env node

/**
 * Direct test of QA service functions
 * This tests the chunking and content extraction logic
 */

const path = require('path');
const fs = require('fs');

console.log('🧪 Testing QA Service Functions Directly\n');

// Read the dev sample
const devSamplePath = path.join(__dirname, 'app/dev-sample.html');
if (!fs.existsSync(devSamplePath)) {
  console.error('❌ Dev sample not found');
  process.exit(1);
}

const htmlContent = fs.readFileSync(devSamplePath, 'utf-8');

// Simple HTML parser to extract text (simulating what preload does)
function extractTextFromHTML(html) {
  // Remove scripts and styles
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  // Extract table data
  const tables = [];
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;
  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableHTML = tableMatch[1];
    const rows = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tableHTML)) !== null) {
      const rowHTML = rowMatch[1];
      const cells = [];
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowHTML)) !== null) {
        const cellText = cellMatch[1].replace(/<[^>]+>/g, '').trim();
        if (cellText) cells.push(cellText);
      }
      if (cells.length > 0) {
        rows.push(cells.join(' | '));
      }
    }
    if (rows.length > 0) {
      tables.push(`[Table Data]\n${rows.join('\n')}\n`);
    }
  }
  
  // Extract text from paragraphs and headings
  const textContent = text
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '\n\n$1\n\n')
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n\n$1\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Combine text and tables
  return textContent + '\n\n' + tables.join('\n\n');
}

console.log('📄 Extracting content from HTML...');
const extractedContent = extractTextFromHTML(htmlContent);
const wordCount = extractedContent.split(/\s+/).length;
const tableCount = (extractedContent.match(/\[Table Data\]/g) || []).length;
const charCount = extractedContent.length;

console.log(`✅ Extracted: ${wordCount} words, ${charCount} chars, ${tableCount} tables\n`);

// Check for key data points
const testData = {
  'market size 2024': /\$184\.7\s+billion/i,
  'financial services adoption': /74\.8%/i,
  'healthcare investment': /\$34\.2\s+billion/i,
  'projected 2028': /\$422\.5\s+billion/i,
  'asia pacific companies': /4,892/i,
  'fortune 500': /63\.5%/i,
  'market size 2022': /\$136\.8\s+billion/i,
  'NLP growth rate': /42\.7%/i,
};

console.log('🔍 Checking for key data points in extracted content:\n');
let foundCount = 0;
for (const [key, regex] of Object.entries(testData)) {
  const found = regex.test(extractedContent);
  console.log(`${found ? '✅' : '❌'} ${key}: ${found ? 'Found' : 'Missing'}`);
  if (found) foundCount++;
}

console.log(`\n📊 Found ${foundCount}/${Object.keys(testData).length} key data points\n`);

// Check chunking simulation
console.log('📦 Simulating chunking (max 400 chars per chunk)...\n');
const chunks = [];
const maxChunkSize = 400;
let currentChunk = '';
const lines = extractedContent.split('\n\n');

for (const line of lines) {
  if (line.includes('[Table Data]')) {
    // Table blocks should be kept together
    if (currentChunk && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
    }
    // Add table as its own chunk (even if large)
    chunks.push(line.trim());
  } else {
    if (currentChunk.length + line.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = line;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + line;
    }
  }
}
if (currentChunk.trim()) {
  chunks.push(currentChunk.trim());
}

console.log(`✅ Created ${chunks.length} chunks\n`);

// Check which chunks contain table data
const chunksWithTables = chunks.filter(c => c.includes('[Table Data]'));
console.log(`📊 Chunks with table data: ${chunksWithTables.length}/${chunks.length}\n`);

// Check chunk sizes
const largeChunks = chunks.filter(c => c.length > maxChunkSize);
if (largeChunks.length > 0) {
  console.log(`⚠️  Warning: ${largeChunks.length} chunks exceed ${maxChunkSize} chars:`);
  largeChunks.forEach((chunk, i) => {
    console.log(`   Chunk ${i + 1}: ${chunk.length} chars (${chunk.substring(0, 50)}...)`);
  });
  console.log('');
} else {
  console.log(`✅ All chunks are within ${maxChunkSize} char limit\n`);
}

// Sample a few chunks
console.log('📝 Sample chunks (first 3):\n');
chunks.slice(0, 3).forEach((chunk, i) => {
  const preview = chunk.substring(0, 150).replace(/\n/g, ' ');
  const hasTable = chunk.includes('[Table Data]');
  console.log(`Chunk ${i + 1} (${chunk.length} chars)${hasTable ? ' 📊' : ''}:`);
  console.log(`   ${preview}...\n`);
});

console.log('✅ Content extraction and chunking simulation complete!\n');
console.log('💡 If the app is not working, check:');
console.log('   1. Is the preload script extracting tables correctly?');
console.log('   2. Are chunks being created properly?');
console.log('   3. Are embeddings being generated for all chunks?');
console.log('   4. Is the similarity search finding the right chunks?\n');

