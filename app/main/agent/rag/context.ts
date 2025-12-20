// Context Retrieval Service - Gets relevant context for a question

import { ContentChunk, RetrievedContext, SearchResult } from '../../../shared/types';
import { getCachedContent } from './cache';
import { searchSimilarChunks } from './similarity';
import { eventLogger } from '../../logging/event-logger';

// Lazy import embeddings to avoid ES module issues at startup
let embeddingsModule: any = null;
async function getEmbeddingsModule() {
  if (!embeddingsModule) {
    embeddingsModule = await import('./embeddings');
  }
  return embeddingsModule;
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

export interface ContextResult {
  context: RetrievedContext;
  searchResults: SearchResult[];
  cache: ReturnType<typeof getCachedContent>;
}

export async function getContextForQuestion(
  question: string,
  tabId: string
): Promise<ContextResult | null> {
  eventLogger.info('RAG Context', `🔍 Getting context for question: "${question.substring(0, 50)}..."`);
  
  // Get cached content
  const cache = getCachedContent(tabId);
  if (!cache) {
    eventLogger.warning('RAG Context', `Page content not cached for tab ${tabId}`);
    return null;
  }

  eventLogger.info('RAG Context', `📄 Analyzing ${cache.chunks.length} content sections...`);
  
  // Validate cache has embeddings
  if (cache.chunkEmbeddings.size === 0) {
    eventLogger.error('RAG Context', 'No embeddings found in cache!');
    throw new Error('No embeddings available for search');
  }
  if (cache.chunkEmbeddings.size !== cache.chunks.length) {
    eventLogger.warning('RAG Context', `Embedding count mismatch: ${cache.chunkEmbeddings.size} embeddings vs ${cache.chunks.length} chunks`);
  }

  // Generate question embedding
  eventLogger.info('RAG Context', '🔍 Understanding your question...');
  const embeddings = await getEmbeddingsModule();
  const questionEmbedding = await embeddings.generateEmbedding(question);
  
  // Validate question embedding
  if (!questionEmbedding || questionEmbedding.length === 0) {
    throw new Error('Question embedding is empty');
  }

  // Search for similar chunks
  eventLogger.info('RAG Context', `🔎 Matching query against ${cache.chunks.length} content chunks...`);
  const searchStartTime = Date.now();
  
  // For numerical/data questions, we might need more chunks
  const isNumericalQuery = /\b(how much|how many|what is|what was|percentage|percent|%|billion|million|dollar|\$|number|count|statistic|data|table|figure)\b/i.test(question);
  const topK = isNumericalQuery ? 2 : 1; // Use 2 chunks for numerical queries, 1 for others
  
  if (isNumericalQuery) {
    eventLogger.info('RAG Context', '📊 Detected numerical/data query - searching top 2 chunks');
  } else {
    eventLogger.info('RAG Context', '⚡ Using top 1 chunk for faster response');
  }
  
  let lastProgressUpdate = 0;
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
        eventLogger.info('RAG Context', `🔍 Comparing chunk ${current}/${total} (${percent}%)...`);
        lastProgressUpdate = now;
      }
    }
  );
  const searchTime = Date.now() - searchStartTime;
  eventLogger.info('RAG Context', `✅ Found ${searchResults.length} matching chunk${searchResults.length !== 1 ? 's' : ''} (${searchTime}ms)`);

  if (searchResults.length === 0) {
    eventLogger.warning('RAG Context', 'No relevant content found for question');
    return null;
  }

  // Retrieve context
  eventLogger.info('RAG Context', '📚 Preparing context from matched chunks...');
  const context = retrieveContext(searchResults, cache.chunks);
  
  eventLogger.info('RAG Context', `📄 Using ${context.primaryChunks.length} primary chunk${context.primaryChunks.length !== 1 ? 's' : ''} for answer`);
  context.primaryChunks.forEach((chunk, idx) => {
    const heading = chunk.metadata.heading || 'Introduction';
    const preview = chunk.content.substring(0, 100).replace(/\n/g, ' ');
    eventLogger.info('RAG Context', `   ${idx + 1}. [${heading}] "${preview}..."`);
  });
  
  eventLogger.info('RAG Context', '✅ Context ready');

  return {
    context,
    searchResults,
    cache,
  };
}

