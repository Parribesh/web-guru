/**
 * Isolated RAG Performance Test
 * Tests different strategies for fetching, chunking, and embedding content
 */

import axios from 'axios';

// Dynamic import for transformers (ES module)
let transformersModule: any = null;
async function loadTransformers() {
  if (!transformersModule) {
    const importExpr = 'import("@xenova/transformers")';
    transformersModule = await eval(importExpr);
  }
  return transformersModule;
}

// Performance timing utilities
class PerformanceTimer {
  private timings: Map<string, number[]> = new Map();

  start(label: string): () => void {
    const startTime = Date.now();
    return () => {
      const duration = Date.now() - startTime;
      if (!this.timings.has(label)) {
        this.timings.set(label, []);
      }
      this.timings.get(label)!.push(duration);
      return duration;
    };
  }

  getStats(): Record<string, { total: number; avg: number; min: number; max: number }> {
    const stats: Record<string, { total: number; avg: number; min: number; max: number }> = {};
    for (const [label, times] of this.timings.entries()) {
      const total = times.reduce((a, b) => a + b, 0);
      stats[label] = {
        total,
        avg: total / times.length,
        min: Math.min(...times),
        max: Math.max(...times),
      };
    }
    return stats;
  }

  printStats(): void {
    console.log('\n📊 Performance Statistics:');
    console.log('='.repeat(60));
    const stats = this.getStats();
    for (const [label, stat] of Object.entries(stats)) {
      console.log(`${label.padEnd(30)}: ${stat.total.toFixed(0)}ms total, ${stat.avg.toFixed(0)}ms avg, ${stat.min.toFixed(0)}ms min, ${stat.max.toFixed(0)}ms max`);
    }
    console.log('='.repeat(60));
  }
}

// Simple HTML text extractor
function extractText(html: string): string {
  // Remove script and style tags
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  // Remove HTML tags but preserve structure
  text = text.replace(/<[^>]+>/g, ' ');
  
  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  
  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

// Strategy 1: Fixed-size chunks matching actual system (200 words max, ~800 chars)
// This matches the actual chunkByParagraphs function behavior
function chunkFixedSize(text: string, maxWords: number = 200, maxChars: number = 800, overlapWords: number = 50): string[] {
  const chunks: string[] = [];
  // Split by paragraphs (matching actual system)
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 20);
  
  let currentChunk = '';
  let currentWordCount = 0;
  let currentCharCount = 0;
  
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    const paraWords = trimmed.split(/\s+/).filter(w => w.length > 0);
    const paraWordCount = paraWords.length;
    const paraCharCount = trimmed.length;
    
    // Check if adding this paragraph would exceed limits
    const wouldExceedWords = currentWordCount + paraWordCount > maxWords;
    const wouldExceedChars = currentCharCount + paraCharCount > maxChars;
    
    if ((wouldExceedWords || wouldExceedChars) && currentChunk) {
      // Save current chunk
      chunks.push(currentChunk.trim());
      
      // Start new chunk with overlap (last 50 words) - THIS CREATES OVERLAP CHUNKS
      const currentWords = currentChunk.split(/\s+/).filter(w => w.length > 0);
      const overlapText = currentWords.slice(-overlapWords).join(' ');
      currentChunk = overlapText + '\n\n' + trimmed;
      currentWordCount = currentChunk.split(/\s+/).filter(w => w.length > 0).length;
      currentCharCount = currentChunk.length;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmed;
      currentWordCount += paraWordCount;
      currentCharCount += paraCharCount;
    }
  }
  
  // Add final chunk
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

// Strategy 2: Semantic chunks matching actual system (100-200 words, ~800 chars)
function chunkSemantic(text: string, minWords: number = 100, maxWords: number = 200, maxChars: number = 800): string[] {
  const chunks: string[] = [];
  
  // Split by double newlines (paragraphs)
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 20);
  
  let currentChunk = '';
  let currentWordCount = 0;
  let currentCharCount = 0;
  
  for (const para of paragraphs) {
    const trimmed = para.trim();
    const paraWords = trimmed.split(/\s+/).filter(w => w.length > 0);
    const paraWordCount = paraWords.length;
    const paraCharCount = trimmed.length;
    
    // Check if adding this paragraph would exceed limits
    const wouldExceedWords = currentWordCount + paraWordCount > maxWords;
    const wouldExceedChars = currentCharCount + paraCharCount > maxChars;
    
    if ((wouldExceedWords || wouldExceedChars) && currentChunk && currentWordCount >= minWords) {
      // Save current chunk
      chunks.push(currentChunk.trim());
      
      // Start new chunk with overlap (last 50 words)
      const overlapWords = currentChunk.split(/\s+/).slice(-50).join(' ');
      currentChunk = overlapWords + '\n\n' + trimmed;
      currentWordCount = currentChunk.split(/\s+/).filter(w => w.length > 0).length;
      currentCharCount = currentChunk.length;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmed;
      currentWordCount += paraWordCount;
      currentCharCount += paraCharCount;
    }
  }
  
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

// Strategy 3: Hybrid chunks matching actual system (200 words, ~800 chars)
function chunkHybrid(text: string, maxWords: number = 200, maxChars: number = 800, overlapWords: number = 50): string[] {
  // First split by paragraphs
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 20);
  
  const chunks: string[] = [];
  let currentChunk = '';
  let currentWordCount = 0;
  let currentCharCount = 0;
  
  for (const para of paragraphs) {
    const trimmed = para.trim();
    const paraWords = trimmed.split(/\s+/).filter(w => w.length > 0);
    const paraWordCount = paraWords.length;
    const paraCharCount = trimmed.length;
    
    // Check if adding this paragraph would exceed limits
    const wouldExceedWords = currentWordCount + paraWordCount > maxWords;
    const wouldExceedChars = currentCharCount + paraCharCount > maxChars;
    
    if ((wouldExceedWords || wouldExceedChars) && currentChunk && currentWordCount > 0) {
      // Save current chunk
      chunks.push(currentChunk.trim());
      
      // Start new chunk with overlap (last N words)
      const overlapText = currentChunk.split(/\s+/).slice(-overlapWords).join(' ');
      currentChunk = overlapText + '\n\n' + trimmed;
      currentWordCount = currentChunk.split(/\s+/).filter(w => w.length > 0).length;
      currentCharCount = currentChunk.length;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmed;
      currentWordCount += paraWordCount;
      currentCharCount += paraCharCount;
    }
    
    // If current chunk exceeds max size significantly, force split by sentences
    if (currentChunk.length > maxChars * 2) {
      const sentences = currentChunk.split(/[.!?]+\s+/).filter(s => s.trim().length > 0);
      let sentenceChunk = '';
      let sentenceWordCount = 0;
      
      for (const sentence of sentences) {
        const sentWords = sentence.split(/\s+/).filter(w => w.length > 0);
        const sentWordCount = sentWords.length;
        const sentCharCount = sentence.length;
        
        if (sentenceWordCount > 0 && (sentenceWordCount + sentWordCount > maxWords || sentenceChunk.length + sentCharCount > maxChars)) {
          chunks.push(sentenceChunk.trim());
          sentenceChunk = sentence;
          sentenceWordCount = sentWordCount;
        } else {
          sentenceChunk += (sentenceChunk ? '. ' : '') + sentence;
          sentenceWordCount += sentWordCount;
        }
      }
      
      currentChunk = sentenceChunk.trim();
      currentWordCount = currentChunk.split(/\s+/).filter(w => w.length > 0).length;
      currentCharCount = currentChunk.length;
    }
  }
  
  // Add remaining chunk
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks.filter(c => c.length > 0);
}

// Fetch HTML from URL
async function fetchHTML(url: string): Promise<string> {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    timeout: 30000,
  });
  return response.data;
}

// Generate embeddings using transformers
async function generateEmbeddings(
  chunks: string[],
  embeddingPipeline: any,
  batchSize: number = 32
): Promise<number[][]> {
  const embeddings: number[][] = [];
  
  // Process in batches for efficiency
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    
    // Process batch in parallel
    const batchPromises = batch.map(async (chunk) => {
      const output = await embeddingPipeline(chunk, {
        pooling: 'mean',
        normalize: true,
      });
      return Array.from(output.data) as number[];
    });
    
    const batchEmbeddings = await Promise.all(batchPromises);
    embeddings.push(...batchEmbeddings);
  }
  
  return embeddings;
}

// Main test function
async function testRAGPerformance() {
  const timer = new PerformanceTimer();
  const url = 'https://en.wikipedia.org/wiki/Nepal';
  
  console.log('🚀 Starting RAG Performance Test');
  console.log(`📄 URL: ${url}\n`);
  
  // Step 1: Fetch HTML
  console.log('📥 Fetching HTML...');
  const fetchEnd = timer.start('1. Fetch HTML');
  const html = await fetchHTML(url);
  fetchEnd();
  console.log(`   ✓ Fetched ${(html.length / 1024).toFixed(1)} KB\n`);
  
  // Step 2: Extract text
  console.log('✂️  Extracting text...');
  const extractEnd = timer.start('2. Extract Text');
  const text = extractText(html);
  extractEnd();
  console.log(`   ✓ Extracted ${(text.length / 1024).toFixed(1)} KB of text (${text.split(/\s+/).length} words)\n`);
  
  // Step 3: Initialize embedding model
  console.log('🤖 Initializing embedding model...');
  const initEnd = timer.start('3. Init Embedding Model');
  const transformers = await loadTransformers();
  if (transformers.env) {
    transformers.env.allowLocalModels = true;
    transformers.env.allowRemoteModels = true;
  }
  const embeddingPipeline = await transformers.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    quantized: true,
  });
  initEnd();
  console.log('   ✓ Model initialized\n');
  
  // Test different chunking strategies (matching actual system parameters)
  const strategies = [
    { name: 'Fixed Size (Actual)', fn: () => chunkFixedSize(text, 200, 800, 50) },
    { name: 'Semantic (Actual)', fn: () => chunkSemantic(text, 100, 200, 800) },
    { name: 'Hybrid (Actual)', fn: () => chunkHybrid(text, 200, 800, 50) },
  ];
  
  const results: Array<{
    strategy: string;
    chunks: string[];
    embeddings: number[][];
    totalTime: number;
  }> = [];
  
  for (const strategy of strategies) {
    console.log(`\n📦 Testing "${strategy.name}" chunking strategy...`);
    const strategyTimer = timer.start(`4. Chunk (${strategy.name})`);
    const chunks = strategy.fn();
    strategyTimer();
    console.log(`   ✓ Created ${chunks.length} chunks`);
    console.log(`   ✓ Avg chunk size: ${Math.round(chunks.reduce((sum, c) => sum + c.length, 0) / chunks.length)} chars`);
    
    // Generate embeddings
    console.log(`   🔢 Generating embeddings for ${chunks.length} chunks...`);
    const embedEnd = timer.start(`5. Embed (${strategy.name})`);
    const embeddings = await generateEmbeddings(chunks, embeddingPipeline, 32);
    embedEnd();
    console.log(`   ✓ Generated ${embeddings.length} embeddings (${embeddings[0]?.length || 0} dimensions each)`);
    
    const chunkTime = timer.getStats()[`4. Chunk (${strategy.name})`]?.total || 0;
    const embedTime = timer.getStats()[`5. Embed (${strategy.name})`]?.total || 0;
    const totalTime = chunkTime + embedTime;
    
    results.push({
      strategy: strategy.name,
      chunks,
      embeddings,
      totalTime,
    });
  }
  
  // Print performance summary
  timer.printStats();
  
  // Compare strategies
  console.log('\n🏆 Strategy Comparison:');
  console.log('='.repeat(60));
  results.sort((a, b) => a.totalTime - b.totalTime);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
    console.log(`${rank} ${r.strategy.padEnd(15)}: ${r.chunks.length} chunks, ${(r.totalTime / 1000).toFixed(2)}s total`);
  }
  console.log('='.repeat(60));
  
  // Best strategy
  const best = results[0];
  console.log(`\n✨ Best Strategy: ${best.strategy}`);
  console.log(`   - Chunks: ${best.chunks.length}`);
  console.log(`   - Total Time: ${(best.totalTime / 1000).toFixed(2)}s`);
  console.log(`   - Time per Chunk: ${(best.totalTime / best.chunks.length).toFixed(0)}ms`);
  console.log(`   - Embeddings: ${best.embeddings.length} vectors`);
  
  return {
    bestStrategy: best.strategy,
    results,
    stats: timer.getStats(),
  };
}

// Run the test
if (require.main === module) {
  testRAGPerformance()
    .then(() => {
      console.log('\n✅ Test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Test failed:', error);
      process.exit(1);
    });
}

export { testRAGPerformance, chunkFixedSize, chunkSemantic, chunkHybrid };

