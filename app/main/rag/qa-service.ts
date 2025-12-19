import { ContentChunk, PageContent, QARequest, QAResponse, RetrievedContext, SearchResult } from '../../shared/types';
import { chunkContent, extractStructure } from './chunking';
import { searchSimilarChunks } from './similarity';
import { generateAnswer, checkOllamaConnection, ensureModelLoaded } from './ollama';
import { eventLogger } from '../logging/event-logger';

// Lazy import embeddings to avoid ES module issues at startup
let embeddingsModule: any = null;
async function getEmbeddingsModule() {
  if (!embeddingsModule) {
    embeddingsModule = await import('./embeddings');
  }
  return embeddingsModule;
}

// Per-tab cache for page content and embeddings
interface TabCache {
  pageContent: PageContent;
  chunks: ContentChunk[];
  chunkEmbeddings: Map<string, number[]>;
  cachedAt: number;
}

const tabCache = new Map<string, TabCache>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export async function initializeQAService(): Promise<void> {
  eventLogger.info('QA Service', 'Initializing QA Service...');
  
  // Initialize embeddings (lazy load) with error handling
  try {
    const embeddings = await getEmbeddingsModule();
    await embeddings.initializeEmbeddings();
  } catch (error: any) {
    eventLogger.error('QA Service', 'Failed to initialize embeddings', error.message || error);
    if (error.message?.includes('EPIPE') || error.code === 'EPIPE') {
      eventLogger.warning('QA Service', 'Embeddings initialization failed due to EPIPE. This may be a network issue.');
    } else {
      throw error;
    }
  }
  
  // Check Ollama connection
  eventLogger.info('QA Service', 'Checking Ollama connection...');
  const ollamaAvailable = await checkOllamaConnection();
  if (!ollamaAvailable) {
    eventLogger.warning('QA Service', 'Ollama not available. QA features will not work.');
    return;
  }
  
  // Ensure model is loaded
  try {
    await ensureModelLoaded();
  } catch (error: any) {
    eventLogger.warning('QA Service', 'Failed to ensure Ollama model is loaded', error.message || error);
    // Don't throw - allow app to continue, QA will show error when used
  }
  
  eventLogger.success('QA Service', 'QA Service initialized successfully');
}

export async function cachePageContent(
  tabId: string,
  extractedText: string,
  htmlContent: string,
  url: string,
  title: string
): Promise<void> {
  const startTime = Date.now();
  eventLogger.info('QA Service', `Caching page content for tab ${tabId}: ${title}`);
  eventLogger.info('QA Service', `URL: ${url}`);

  // Extract structure
  eventLogger.info('QA Service', 'Extracting page structure...');
  const structure = extractStructure(htmlContent, extractedText);
  eventLogger.success('QA Service', `Extracted ${structure.sections.length} sections`);

  // Create page content object
  const pageContent: PageContent = {
    url,
    title,
    extractedText,
    structure,
    metadata: {
      extractedAt: Date.now(),
      wordCount: extractedText.split(/\s+/).length,
    },
  };

  eventLogger.info('QA Service', `Page has ${pageContent.metadata.wordCount} words`);

  // Chunk the content
  eventLogger.info('QA Service', 'Chunking page content...');
  const chunks = chunkContent(pageContent);
  eventLogger.success('QA Service', `Created ${chunks.length} content chunks`);
  
  // Log summary of chunks
  const chunksWithContent = chunks.filter(c => c.content && c.content.trim().length > 0);
  const chunksWithoutContent = chunks.length - chunksWithContent.length;
  if (chunksWithoutContent > 0) {
    eventLogger.warning('QA Service', `${chunksWithoutContent} chunks have no content!`);
  }
  eventLogger.info('QA Service', `Chunks with content: ${chunksWithContent.length}/${chunks.length}`);
  
  // Log first few chunks for debugging
  chunks.slice(0, 3).forEach((chunk, idx) => {
    const preview = chunk.content ? chunk.content.substring(0, 100).replace(/\n/g, ' ') : 'NO CONTENT';
    eventLogger.debug('QA Service', `Chunk ${idx + 1}: "${chunk.metadata.heading || 'No heading'}" - ${chunk.content?.length || 0} chars - "${preview}..."`);
  });

  // Generate embeddings (lazy load module)
  eventLogger.info('QA Service', `Generating embeddings for ${chunks.length} chunks...`);
  eventLogger.info('QA Service', 'This may take a moment...');
  const embeddings = await getEmbeddingsModule();
  const chunkEmbeddings = await embeddings.generateChunkEmbeddings(chunks);

  // Cache everything
  tabCache.set(tabId, {
    pageContent,
    chunks,
    chunkEmbeddings,
    cachedAt: Date.now(),
  });

  const processingTime = Date.now() - startTime;
  eventLogger.success('QA Service', `Cached ${chunks.length} chunks with embeddings for tab ${tabId} in ${processingTime}ms`);
  eventLogger.info('QA Service', `Embeddings ready for semantic search on this page`);
}

function getCachedContent(tabId: string): TabCache | null {
  const cache = tabCache.get(tabId);
  if (!cache) {
    return null;
  }

  // Check if cache is expired
  if (Date.now() - cache.cachedAt > CACHE_TTL) {
    tabCache.delete(tabId);
    return null;
  }

  return cache;
}

function retrieveContext(searchResults: SearchResult[], allChunks: ContentChunk[]): RetrievedContext {
  const primaryChunks = searchResults.map(r => r.chunk);
  
  // Get surrounding chunks for context
  const surroundingChunks: ContentChunk[] = [];
  const chunkIndices = new Map<string, number>();
  
  allChunks.forEach((chunk, index) => {
    chunkIndices.set(chunk.id, index);
  });

  for (const result of searchResults) {
    const index = chunkIndices.get(result.chunk.id);
    if (index !== undefined) {
      // Get previous chunk
      if (index > 0) {
        const prevChunk = allChunks[index - 1];
        if (!surroundingChunks.find(c => c.id === prevChunk.id)) {
          surroundingChunks.push(prevChunk);
        }
      }
      // Get next chunk
      if (index < allChunks.length - 1) {
        const nextChunk = allChunks[index + 1];
        if (!surroundingChunks.find(c => c.id === nextChunk.id)) {
          surroundingChunks.push(nextChunk);
        }
      }
    }
  }

  // Get section context from first primary chunk
  const firstChunk = primaryChunks[0];
  const sectionContext = {
    heading: firstChunk.metadata.heading || 'Introduction',
    fullSection: firstChunk.metadata.sectionId,
  };

  return {
    primaryChunks,
    surroundingChunks: surroundingChunks.slice(0, 3), // Limit to 3 surrounding chunks
    sectionContext,
    metadata: {
      totalChunks: allChunks.length,
      searchTime: 0, // Could track this if needed
    },
  };
}

export async function answerQuestion(request: QARequest): Promise<QAResponse> {
  const startTime = Date.now();
  eventLogger.info('QA Service', `💭 Processing your question...`);
  eventLogger.debug('QA Service', `Question: "${request.question.substring(0, 50)}..."`);
  eventLogger.debug('QA Service', `Tab ID: ${request.tabId}`);

  try {
    // Get cached content
    const cache = getCachedContent(request.tabId);
    if (!cache) {
      eventLogger.warning('QA Service', `Page content not cached for tab ${request.tabId}`);
      eventLogger.warning('QA Service', 'Please wait for page to load completely before asking questions');
      return {
        success: false,
        answer: '',
        explanation: '',
        relevantChunks: [],
        confidence: 0,
        sourceLocation: {
          approximatePosition: 'unknown',
        },
        error: 'Page content not cached. Please wait for page to load completely.',
      };
    }

    eventLogger.info('QA Service', `📄 Analyzing ${cache.chunks.length} content sections...`);
    
    // Count chunks with table data
    const chunksWithTables = cache.chunks.filter(chunk => 
      chunk.content && chunk.content.includes('[Table Data]')
    ).length;
    if (chunksWithTables > 0) {
      eventLogger.info('QA Service', `📊 Found ${chunksWithTables} chunk(s) containing table data`);
    }
    
    // Validate cache has embeddings
    if (cache.chunkEmbeddings.size === 0) {
      eventLogger.error('QA Service', 'No embeddings found in cache!');
      throw new Error('No embeddings available for search');
    }
    if (cache.chunkEmbeddings.size !== cache.chunks.length) {
      eventLogger.warning('QA Service', `Embedding count mismatch: ${cache.chunkEmbeddings.size} embeddings vs ${cache.chunks.length} chunks`);
    }
    
    // Sample a few chunk embeddings to verify they're different
    const sampleEmbeddings = Array.from(cache.chunkEmbeddings.values()).slice(0, 3);
    if (sampleEmbeddings.length > 1) {
      const first = sampleEmbeddings[0];
      const second = sampleEmbeddings[1];
      let differences = 0;
      for (let i = 0; i < Math.min(first.length, second.length); i++) {
        if (Math.abs(first[i] - second[i]) > 0.0001) differences++;
      }
      eventLogger.debug('QA Service', `Sample embeddings: ${differences}/${first.length} dimensions differ (should be most)`);
    }

    // Generate question embedding (lazy load module)
    eventLogger.info('QA Service', '🔍 Understanding your question...');
    const embeddings = await getEmbeddingsModule();
    const questionEmbedding = await embeddings.generateEmbedding(request.question);
    
    // Validate question embedding
    if (!questionEmbedding || questionEmbedding.length === 0) {
      throw new Error('Question embedding is empty');
    }
    const questionNorm = Math.sqrt(questionEmbedding.reduce((sum: number, v: number) => sum + v * v, 0));
    const questionMin = Math.min(...questionEmbedding);
    const questionMax = Math.max(...questionEmbedding);
    const questionMean = questionEmbedding.reduce((sum: number, v: number) => sum + v, 0) / questionEmbedding.length;
    eventLogger.info('QA Service', `Question embedding: dim=${questionEmbedding.length}, norm=${questionNorm.toFixed(4)}, min=${questionMin.toFixed(4)}, max=${questionMax.toFixed(4)}, mean=${questionMean.toFixed(4)}`);
    
    // Validate question embedding
    if (questionNorm < 0.001) {
      eventLogger.error('QA Service', 'Question embedding is too small (near zero) - embedding generation may have failed');
    }
    
    // Verify question embedding is different from chunk embeddings
    if (sampleEmbeddings.length > 0) {
      const sampleChunk = sampleEmbeddings[0];
      if (questionEmbedding.length === sampleChunk.length) {
        let differences = 0;
        for (let i = 0; i < questionEmbedding.length; i++) {
          if (Math.abs(questionEmbedding[i] - sampleChunk[i]) > 0.0001) differences++;
        }
        eventLogger.info('QA Service', `Question vs chunk embedding: ${differences}/${questionEmbedding.length} dimensions differ (should be most)`);
      }
    }
    
    eventLogger.info('QA Service', '✅ Question understood');

    // Search for similar chunks
    eventLogger.info('QA Service', `🔎 Matching query against ${cache.chunks.length} content chunks...`);
    const searchStartTime = Date.now();
    let lastProgressUpdate = 0;
    
    // For numerical/data questions, we might need more chunks to find the right table
    // Check if question contains number-related keywords
    const isNumericalQuery = /\b(how much|how many|what is|what was|percentage|percent|%|billion|million|dollar|\$|number|count|statistic|data|table|figure)\b/i.test(request.question);
    // Reduced to 1-2 chunks for faster responses (was 2-3)
    const topK = isNumericalQuery ? 2 : 1; // Use 2 chunks for numerical queries, 1 for others
    
    if (isNumericalQuery) {
      eventLogger.info('QA Service', '📊 Detected numerical/data query - searching top 2 chunks');
    } else {
      eventLogger.info('QA Service', '⚡ Using top 1 chunk for faster response');
    }
    
    const searchResults = searchSimilarChunks(
      questionEmbedding,
      cache.chunks,
      cache.chunkEmbeddings,
      topK,
      (current, total, similarity) => {
        // Log progress every 10 chunks or on completion
        const now = Date.now();
        if (current % 10 === 0 || current === total || now - lastProgressUpdate > 500) {
          const percent = Math.round((current / total) * 100);
          eventLogger.info('QA Service', `🔍 Comparing chunk ${current}/${total} (${percent}%)...`);
          lastProgressUpdate = now;
        }
      }
    );
    const searchTime = Date.now() - searchStartTime;
    eventLogger.info('QA Service', `✅ Found ${searchResults.length} matching chunk${searchResults.length !== 1 ? 's' : ''} (${searchTime}ms)`);
    
    // Log details about each matching chunk
    if (searchResults.length > 0) {
      // Check if all similarities are the same (indicates a problem)
      const similarities = searchResults.map(r => r.similarity);
      const allSame = similarities.every(s => Math.abs(s - similarities[0]) < 0.0001);
      if (allSame && searchResults.length > 1) {
        eventLogger.warning('QA Service', `⚠️ All chunks have identical similarity (${(similarities[0] * 100).toFixed(1)}%) - this may indicate an embedding issue`);
      }
      
      searchResults.forEach((result, index) => {
        const similarity = (result.similarity * 100).toFixed(1);
        const chunkContent = result.chunk.content || '';
        const chunkPreview = chunkContent.length > 80 
          ? chunkContent.substring(0, 80).replace(/\n/g, ' ') + '...'
          : chunkContent.replace(/\n/g, ' ');
        const heading = result.chunk.metadata.heading || 'No heading';
        const hasTableData = chunkContent.includes('[Table Data]');
        const tableIndicator = hasTableData ? ' 📊' : '';
        eventLogger.info('QA Service', `📌 Match ${index + 1}: ${similarity}% [${heading}]${tableIndicator} - "${chunkPreview}"`);
        
        if (hasTableData) {
          const tableLines = chunkContent.split('\n').filter(line => line.includes('|')).length;
          eventLogger.info('QA Service', `   📊 Chunk ${index + 1} contains table data (${tableLines} table rows)`);
        }
        
        // Log chunk embedding info for debugging
        const chunkEmbedding = cache.chunkEmbeddings.get(result.chunk.id);
        if (chunkEmbedding) {
          const chunkNorm = Math.sqrt(chunkEmbedding.reduce((sum: number, v: number) => sum + v * v, 0));
          const chunkMin = Math.min(...chunkEmbedding);
          const chunkMax = Math.max(...chunkEmbedding);
          const chunkMean = chunkEmbedding.reduce((sum: number, v: number) => sum + v, 0) / chunkEmbedding.length;
          eventLogger.info('QA Service', `   Chunk ${index + 1} embedding: dim=${chunkEmbedding.length}, norm=${chunkNorm.toFixed(4)}, min=${chunkMin.toFixed(4)}, max=${chunkMax.toFixed(4)}, mean=${chunkMean.toFixed(4)}`);
          eventLogger.info('QA Service', `   Chunk ${index + 1} content length: ${chunkContent.length} chars`);
          
          // Check if chunk embedding is valid
          if (chunkNorm < 0.001) {
            eventLogger.warning('QA Service', `   ⚠️ Chunk ${index + 1} embedding is too small (near zero)`);
          }
        } else {
          eventLogger.error('QA Service', `   ❌ Chunk ${index + 1} has no embedding!`);
        }
      });
    }

    if (searchResults.length === 0) {
      eventLogger.warning('QA Service', 'No relevant content found for question');
      return {
        success: false,
        answer: '',
        explanation: '',
        relevantChunks: [],
        confidence: 0,
        sourceLocation: {
          approximatePosition: 'unknown',
        },
        error: 'No relevant content found for this question.',
      };
    }

    // Retrieve context
    eventLogger.info('QA Service', '📚 Preparing context from matched chunks...');
    const context = retrieveContext(searchResults, cache.chunks);
    
    // Log which chunks will be used
    eventLogger.info('QA Service', `📄 Using ${context.primaryChunks.length} primary chunk${context.primaryChunks.length !== 1 ? 's' : ''} for answer`);
    context.primaryChunks.forEach((chunk, idx) => {
      const heading = chunk.metadata.heading || 'Introduction';
      const preview = chunk.content.substring(0, 100).replace(/\n/g, ' ');
      eventLogger.info('QA Service', `   ${idx + 1}. [${heading}] "${preview}..."`);
    });
    
    eventLogger.info('QA Service', '✅ Context ready');

    // Generate answer using Ollama
    eventLogger.info('QA Service', `🤖 Generating answer using ${context.primaryChunks.length} matched chunk${context.primaryChunks.length !== 1 ? 's' : ''}...`);
    let answer: string;
    let prompt: string | undefined;
    try {
      // Double-check connection before generating
      const isConnected = await checkOllamaConnection();
      if (!isConnected) {
        throw new Error('Ollama connection check failed');
      }
      
      const result = await generateAnswer(
        request.question,
        context,
        {
          url: cache.pageContent.url,
          title: cache.pageContent.title,
        }
      );
      answer = result.answer;
      prompt = result.prompt;
      eventLogger.info('QA Service', '✅ Answer generated');
    } catch (error: any) {
      // Log full error details
      eventLogger.error('QA Service', 'Answer generation failed', {
        message: error.message,
        code: error.code,
        syscall: error.syscall,
        address: error.address,
        port: error.port,
      });
      
      // If Ollama is not available, provide a fallback response
      if (error.message?.includes('Ollama is not running') || 
          error.message?.includes('connection check failed') ||
          error.code === 'ECONNREFUSED') {
        eventLogger.warning('QA Service', 'Ollama not available, providing fallback response');
        answer = `I found relevant information, but I cannot generate a full answer because Ollama is not running.\n\n` +
          `Please start Ollama with: ollama serve\n\n` +
          `Relevant content from the page:\n${context.primaryChunks.map((c, i) => `\n[${i + 1}] ${c.content.substring(0, 200)}...`).join('\n')}`;
        // Build prompt for fallback (even though it wasn't sent)
        // Import dynamically to avoid circular dependency
        const ollamaModule = await import('./ollama');
        prompt = ollamaModule.buildQAPrompt(request.question, context, {
          url: cache.pageContent.url,
          title: cache.pageContent.title,
        });
      } else {
        eventLogger.error('QA Service', 'Failed to generate answer', error.message || error);
        throw error;
      }
    }

    // Calculate confidence based on similarity scores
    const avgSimilarity = searchResults.reduce((sum: number, r: SearchResult) => sum + r.similarity, 0) / searchResults.length;
    const confidence = Math.min(avgSimilarity * 1.2, 1.0); // Boost confidence slightly

    // Format relevant chunks for display
    const relevantChunks = searchResults.map((result, index) => {
      // Get full chunk content, not truncated
      const chunkContent = result.chunk.content || '';
      // Show first 300 characters, but don't add "..." if content is shorter
      const excerpt = chunkContent.length > 300 
        ? chunkContent.substring(0, 300) + '...' 
        : chunkContent;
      
      return {
        chunkId: result.chunk.id,
        excerpt: excerpt || 'No content available',
        relevance: `Similarity: ${(result.similarity * 100).toFixed(1)}%`,
      };
    });

    const processingTime = Date.now() - startTime;
    eventLogger.success('QA Service', `Question answered in ${processingTime}ms`);

    return {
      success: true,
      answer,
      explanation: `Based on ${searchResults.length} relevant section(s) from the page.`,
      relevantChunks,
      confidence,
      prompt, // Include the prompt sent to LLM
      sourceLocation: {
        section: context.sectionContext.heading,
        approximatePosition: `Section ${searchResults[0].rank} of ${cache.chunks.length}`,
      },
      metadata: {
        processingTime,
        chunksSearched: cache.chunks.length,
        model: 'llama3.2:latest',
      },
    };
  } catch (error) {
    eventLogger.error('QA Service', 'QA service error', error instanceof Error ? error.message : 'Unknown error');
    return {
      success: false,
      answer: '',
      explanation: '',
      relevantChunks: [],
      confidence: 0,
      sourceLocation: {
        approximatePosition: 'unknown',
      },
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      metadata: {
        processingTime: Date.now() - startTime,
      },
    };
  }
}

export function clearCache(tabId?: string): void {
  if (tabId) {
    tabCache.delete(tabId);
    console.log(`🗑️ Cleared cache for tab ${tabId}`);
  } else {
    tabCache.clear();
    console.log('🗑️ Cleared all caches');
  }
}

