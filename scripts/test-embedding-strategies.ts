/**
 * Embedding Strategy Performance Test
 * Tests different embedding generation strategies one at a time
 * Uses actual chunking logic from the codebase to create real chunks
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { chunkContent, extractStructure } from '../app/main/agent/rag/chunking';
import { extractComponents } from '../app/main/agent/rag/components';
import { findSessionByUrl, getAllSessionIds } from '../app/main/agent/rag/session-storage';
import { PageContent, DOMComponent } from '../app/shared/types';

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

  start(label: string): () => number {
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

  getStats(): Record<string, { total: number; avg: number; min: number; max: number; count: number }> {
    const stats: Record<string, { total: number; avg: number; min: number; max: number; count: number }> = {};
    for (const [label, times] of this.timings.entries()) {
      const total = times.reduce((a, b) => a + b, 0);
      stats[label] = {
        total,
        avg: total / times.length,
        min: Math.min(...times),
        max: Math.max(...times),
        count: times.length,
      };
    }
    return stats;
  }

  reset(): void {
    this.timings.clear();
  }
}

// Extract text matching the browser DOM extraction (granular, element-by-element)
// This simulates how the preload script extracts content from the DOM
function extractText(html: string): string {
  // Use a simple HTML parser approach to extract content element-by-element
  // This matches the browser's granular extraction which creates more chunks
  
  // Remove scripts and styles
  let cleaned = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  cleaned = cleaned.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  cleaned = cleaned.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');
  
  // Remove navigation and sidebar elements (like browser does)
  cleaned = cleaned.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
  cleaned = cleaned.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '');
  cleaned = cleaned.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
  cleaned = cleaned.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
  
  // Try to find main content area (like browser does)
  const mainContentMatch = cleaned.match(/<(?:article|main|div[^>]*id=["']content["']|div[^>]*id=["']mw-content-text["'])[^>]*>([\s\S]*?)<\/(?:article|main|div)>/i);
  const contentToProcess = mainContentMatch ? mainContentMatch[1] : cleaned;
  
  // Extract paragraphs, headings, list items element-by-element (like browser does)
  // This creates many more paragraph breaks, leading to more chunks
  const content: string[] = [];
  
  // Extract paragraphs
  const paragraphMatches = contentToProcess.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
  for (const match of paragraphMatches) {
    const text = match[1].replace(/<[^>]+>/g, '').trim();
    if (text.length > 30) {
      content.push(text);
    }
  }
  
  // Extract headings
  const headingMatches = contentToProcess.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi);
  for (const match of headingMatches) {
    const text = match[1].replace(/<[^>]+>/g, '').trim();
    if (text.length > 10) {
      content.push(text);
    }
  }
  
  // Extract list items
  const listItemMatches = contentToProcess.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi);
  for (const match of listItemMatches) {
    const text = match[1].replace(/<[^>]+>/g, '').trim();
    if (text.length > 20) {
      content.push(text);
    }
  }
  
  // Extract table rows
  const tableRowMatches = contentToProcess.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const match of tableRowMatches) {
    const cells = match[1].matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi);
    const rowData: string[] = [];
    for (const cell of cells) {
      const text = cell[1].replace(/<[^>]+>/g, '').trim();
      if (text) rowData.push(text);
    }
    if (rowData.length > 0) {
      content.push('[Table Data]\n' + rowData.join(' | ') + '\n');
    }
  }
  
  // If we didn't find structured content, fall back to simple extraction
  if (content.length === 0) {
    // Fallback: extract all text elements
    const allTextMatches = contentToProcess.matchAll(/<[^>]+>([^<]+)<\/[^>]+>/gi);
    for (const match of allTextMatches) {
      const text = match[1].trim();
      if (text.length > 30) {
        content.push(text);
      }
    }
  }
  
  // Join with double newlines (like browser does) - this creates many paragraph boundaries
  let result = content.join('\n\n');
  
  // Decode HTML entities
  result = result
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
  
  // Clean up whitespace but preserve paragraph breaks
  result = result.replace(/\n{3,}/g, '\n\n').trim();
  
  return result;
}

// Create PageContent from HTML using actual chunking logic
function createPageContent(html: string, url: string, title: string): PageContent {
  const extractedText = extractText(html);
  const structure = extractStructure(html, extractedText);
  
  return {
    url,
    title,
    extractedText,
    structure,
    metadata: {
      extractedAt: Date.now(),
      wordCount: extractedText.split(/\s+/).length,
    },
  };
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

// Strategy 1: Sequential (one at a time)
async function embedSequential(chunks: string[], pipeline: any): Promise<number[][]> {
  const embeddings: number[][] = [];
  
  for (const chunk of chunks) {
    const output = await pipeline(chunk, {
      pooling: 'mean',
      normalize: true,
    });
    embeddings.push(Array.from(output.data) as number[]);
  }
  
  return embeddings;
}

// Strategy 2: Parallel batches (process in batches of N, all in parallel)
async function embedParallelBatches(chunks: string[], pipeline: any, batchSize: number = 32): Promise<number[][]> {
  const embeddings: number[][] = [];
  
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    
    const batchPromises = batch.map(async (chunk) => {
      const output = await pipeline(chunk, {
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

// Strategy 3: All parallel (process all chunks at once)
async function embedAllParallel(chunks: string[], pipeline: any): Promise<number[][]> {
  const promises = chunks.map(async (chunk) => {
    const output = await pipeline(chunk, {
      pooling: 'mean',
      normalize: true,
    });
    return Array.from(output.data) as number[];
  });
  
  return Promise.all(promises);
}

// Strategy 4: Sequential with progress (one at a time with progress tracking)
async function embedSequentialWithProgress(
  chunks: string[],
  pipeline: any,
  progressCallback?: (current: number, total: number) => void
): Promise<number[][]> {
  const embeddings: number[][] = [];
  
  for (let i = 0; i < chunks.length; i++) {
    const output = await pipeline(chunks[i], {
      pooling: 'mean',
      normalize: true,
    });
    embeddings.push(Array.from(output.data) as number[]);
    
    if (progressCallback) {
      progressCallback(i + 1, chunks.length);
    }
  }
  
  return embeddings;
}

// Test a single strategy
async function testStrategy(
  strategyName: string,
  strategyFn: (chunks: string[], pipeline: any) => Promise<number[][]>,
  chunks: string[],
  pipeline: any,
  timer: PerformanceTimer
): Promise<{ embeddings: number[][]; stats: any }> {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🧪 Testing Strategy: ${strategyName}`);
  console.log(`${'='.repeat(70)}`);
  console.log(`📊 Chunks to process: ${chunks.length}`);
  
  const embedEnd = timer.start(`Embed (${strategyName})`);
  const embeddings = await strategyFn(chunks, pipeline);
  embedEnd();
  
  const stats = timer.getStats()[`Embed (${strategyName})`];
  
  console.log(`\n✅ Strategy: ${strategyName}`);
  console.log(`   - Total Time: ${(stats.total / 1000).toFixed(2)}s`);
  console.log(`   - Average Time: ${stats.avg.toFixed(2)}ms`);
  console.log(`   - Min Time: ${stats.min.toFixed(2)}ms`);
  console.log(`   - Max Time: ${stats.max.toFixed(2)}ms`);
  console.log(`   - Time per Chunk: ${(stats.total / chunks.length).toFixed(2)}ms`);
  console.log(`   - Chunks per Second: ${((chunks.length / stats.total) * 1000).toFixed(1)}`);
  console.log(`   - Embeddings Generated: ${embeddings.length}`);
  console.log(`   - Embedding Dimensions: ${embeddings[0]?.length || 0}`);
  
  return { embeddings, stats };
}

// Main test function
async function testEmbeddingStrategies() {
  const timer = new PerformanceTimer();
  const url = 'https://en.wikipedia.org/wiki/Nepal';
  
  console.log('🚀 Starting Embedding Strategy Performance Test');
  console.log(`📄 URL: ${url}\n`);
  
  // Step 1: Try to load chunks from saved session
  console.log('🔍 Checking for saved session data...');
  let chunks: string[] = [];
  let loadedFromCache = false;
  
  const savedSession = findSessionByUrl(url);
  if (savedSession && savedSession.chunks.length > 0) {
    console.log(`   ✓ Found saved session with ${savedSession.chunks.length} chunks`);
    
    // Flatten chunks including nested chunks
    for (const chunk of savedSession.chunks) {
      chunks.push(chunk.content);
      if (chunk.nestedChunks) {
        for (const nested of chunk.nestedChunks) {
          chunks.push(nested.content);
        }
      }
    }
    
    loadedFromCache = true;
    console.log(`   ✓ Loaded ${chunks.length} chunks from saved session`);
    console.log(`   ✓ Avg chunk size: ${Math.round(chunks.reduce((sum, c) => sum + c.length, 0) / chunks.length)} chars\n`);
  } else {
    console.log('   ⚠️  No saved session found, will create chunks from HTML\n');
    
    // Step 2: Fetch HTML
    console.log('📥 Fetching HTML...');
    const fetchEnd = timer.start('Fetch HTML');
    const html = await fetchHTML(url);
    fetchEnd();
    console.log(`   ✓ Fetched ${(html.length / 1024).toFixed(1)} KB\n`);
    
    // Step 3: Extract text
    console.log('✂️  Extracting text...');
    const extractEnd = timer.start('Extract Text');
    const text = extractText(html);
    extractEnd();
    console.log(`   ✓ Extracted ${(text.length / 1024).toFixed(1)} KB of text (${text.split(/\s+/).length} words)\n`);
    
    // Step 4: Create PageContent and use actual chunking logic (with components!)
    console.log('📦 Creating PageContent and using actual chunking logic...');
    const chunkEnd = timer.start('Create Chunks');
    const pageContent = createPageContent(html, url, 'Nepal - Wikipedia');
    
    // Extract components (this is what creates many chunks!)
    console.log('   🔍 Extracting DOM components...');
    const components = extractComponents(html, pageContent.extractedText);
    console.log(`   ✓ Extracted ${components.length} components`);
    
    // Use actual chunking with components
    const contentChunks = chunkContent(pageContent, components);
    
    // Flatten chunks including nested chunks (forms have nested input-group and button chunks)
    for (const chunk of contentChunks) {
      chunks.push(chunk.content);
      // Add nested chunks if they exist
      if (chunk.nestedChunks) {
        for (const nested of chunk.nestedChunks) {
          chunks.push(nested.content);
        }
      }
    }
    
    chunkEnd();
    console.log(`   ✓ Created ${contentChunks.length} top-level chunks`);
    console.log(`   ✓ Total chunks (including nested): ${chunks.length}`);
    console.log(`   ✓ Avg chunk size: ${Math.round(chunks.reduce((sum, c) => sum + c.length, 0) / chunks.length)} chars`);
    console.log(`   ✓ Chunk types: ${Array.from(new Set(contentChunks.map(c => c.componentType))).join(', ')}`);
    console.log(`   ✓ Components extracted: ${components.length}\n`);
  }
  
  if (chunks.length === 0) {
    throw new Error('No chunks available for testing');
  }
  
  // Step 5: Initialize embedding model
  console.log('🤖 Initializing embedding model...');
  const initEnd = timer.start('Init Model');
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
  
  // Test strategies one at a time
  const strategies = [
    {
      name: 'Sequential',
      fn: embedSequential,
      description: 'Process chunks one at a time, sequentially',
    },
    {
      name: 'Parallel Batches (32)',
      fn: (chunks, pipeline) => embedParallelBatches(chunks, pipeline, 32),
      description: 'Process in batches of 32 chunks, all chunks in batch processed in parallel',
    },
    {
      name: 'Parallel Batches (64)',
      fn: (chunks, pipeline) => embedParallelBatches(chunks, pipeline, 64),
      description: 'Process in batches of 64 chunks, all chunks in batch processed in parallel',
    },
    {
      name: 'Parallel Batches (128)',
      fn: (chunks, pipeline) => embedParallelBatches(chunks, pipeline, 128),
      description: 'Process in batches of 128 chunks, all chunks in batch processed in parallel',
    },
    {
      name: 'All Parallel',
      fn: embedAllParallel,
      description: 'Process all chunks in parallel at once (maximum parallelism)',
    },
  ];
  
  const results: Array<{
    name: string;
    description: string;
    stats: any;
    embeddings: number[][];
  }> = [];
  
  for (const strategy of strategies) {
    // Reset timer for this strategy
    timer.reset();
    
    // Test the strategy
    const result = await testStrategy(strategy.name, strategy.fn, chunks, embeddingPipeline, timer);
    
    results.push({
      name: strategy.name,
      description: strategy.description,
      stats: result.stats,
      embeddings: result.embeddings,
    });
    
    // Wait a bit between strategies to avoid resource contention
    console.log('\n⏳ Waiting 2 seconds before next strategy...\n');
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // Final comparison report
  console.log(`\n${'='.repeat(70)}`);
  console.log('📊 FINAL PERFORMANCE REPORT');
  console.log(`${'='.repeat(70)}\n`);
  
  // Sort by total time
  results.sort((a, b) => a.stats.total - b.stats.total);
  
  console.log('🏆 Strategy Rankings (fastest to slowest):\n');
  results.forEach((result, index) => {
    const rank = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
    console.log(`${rank} ${result.name.padEnd(25)}: ${(result.stats.total / 1000).toFixed(2)}s total, ${(result.stats.total / chunks.length).toFixed(2)}ms/chunk, ${((chunks.length / result.stats.total) * 1000).toFixed(1)} chunks/sec`);
    console.log(`   ${result.description}`);
  });
  
  console.log(`\n${'='.repeat(70)}`);
  console.log('✨ Best Strategy:', results[0].name);
  console.log(`   - Total Time: ${(results[0].stats.total / 1000).toFixed(2)}s`);
  console.log(`   - Time per Chunk: ${(results[0].stats.total / chunks.length).toFixed(2)}ms`);
  console.log(`   - Throughput: ${((chunks.length / results[0].stats.total) * 1000).toFixed(1)} chunks/second`);
  console.log(`${'='.repeat(70)}\n`);
  
  return {
    chunks: chunks.length,
    results,
    bestStrategy: results[0].name,
  };
}

// Run the test
if (require.main === module) {
  testEmbeddingStrategies()
    .then(() => {
        console.log('\n✅ Test completed successfully');
        process.exit(0);
      })
    .catch((error) => {
      console.error('\n❌ Test failed:', error);
      process.exit(1);
    });
}

export { testEmbeddingStrategies };

