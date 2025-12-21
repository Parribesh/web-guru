// Context Retrieval Service - Gets relevant context for a question

import { ContentChunk, RetrievedContext, SearchResult } from '../../../shared/types';
import { getCachedContent } from './cache';
import { searchSimilarChunks } from './similarity';
import { detectRelevantComponentTypes, filterChunksByComponentType, getInteractiveComponentChunks } from './component-filter';
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
  
  // Log component information
  const componentChunks = cache.chunks.filter(c => c.componentType && c.componentType !== 'text');
  if (componentChunks.length > 0) {
    eventLogger.info('RAG Context', `Found ${componentChunks.length} component chunks (${componentChunks.filter(c => c.componentType === 'form').length} forms, ${componentChunks.filter(c => c.componentType === 'button').length} buttons, ${componentChunks.filter(c => c.componentType === 'table').length} tables)`);
  }
  
  // Validate cache has embeddings
  if (cache.chunkEmbeddings.size === 0) {
    eventLogger.error('RAG Context', 'No embeddings found in cache!');
    throw new Error('No embeddings available for search');
  }
  if (cache.chunkEmbeddings.size !== cache.chunks.length) {
    eventLogger.warning('RAG Context', `Embedding count mismatch: ${cache.chunkEmbeddings.size} embeddings vs ${cache.chunks.length} chunks`);
  }

  // Stage 1: Detect relevant component types and filter chunks (using semantic similarity)
  eventLogger.info('RAG Context', '🔍 Stage 1: Detecting relevant component types using semantic analysis...');
  const relevantComponentTypes = await detectRelevantComponentTypes(question);
  
  let chunksToSearch = cache.chunks;
  let filteredChunks: ContentChunk[] = [];
  
  if (relevantComponentTypes.length > 0) {
    // Filter chunks by component type first
    filteredChunks = filterChunksByComponentType(cache.chunks, relevantComponentTypes);
    
    if (filteredChunks.length > 0) {
      eventLogger.info('RAG Context', `📦 Filtered to ${filteredChunks.length} component chunks (from ${cache.chunks.length} total)`);
      chunksToSearch = filteredChunks;
    } else {
      eventLogger.warning('RAG Context', 'No chunks found for detected component types, falling back to all chunks');
      chunksToSearch = cache.chunks;
    }
  } else {
    eventLogger.info('RAG Context', 'No specific component types detected - searching all chunks');
  }

  // Generate question embedding
  eventLogger.info('RAG Context', '🔍 Stage 2: Understanding your question...');
  const embeddings = await getEmbeddingsModule();
  const questionEmbedding = await embeddings.generateEmbedding(question);
  
  // Validate question embedding
  if (!questionEmbedding || questionEmbedding.length === 0) {
    throw new Error('Question embedding is empty');
  }

  // Stage 2: Semantic search within filtered chunks
  eventLogger.info('RAG Context', `🔎 Stage 2: Matching query against ${chunksToSearch.length} filtered chunks...`);
  const searchStartTime = Date.now();
  
  // Detect query type to determine search strategy
  const isNumericalQuery = /\b(how much|how many|what is|what was|percentage|percent|%|billion|million|dollar|\$|number|count|statistic|data|table|figure)\b/i.test(question);
  const isFormQuery = /\b(form|fill|input|field|submit|button|enter|type|select|dropdown|checkbox|radio)\b/i.test(question);
  const isInteractionQuery = /\b(click|press|select|choose|interact|use|submit|send)\b/i.test(question);
  
  // Adjust topK based on query type
  let topK = 1;
  if (isNumericalQuery) {
    topK = 2;
    eventLogger.info('RAG Context', '📊 Detected numerical/data query - searching top 2 chunks');
  } else if (isFormQuery || isInteractionQuery) {
    topK = 5; // Get more chunks for form/interaction queries to find all relevant components
    eventLogger.info('RAG Context', '🔘 Detected form/interaction query - searching top 5 chunks for components');
  } else {
    eventLogger.info('RAG Context', '⚡ Using top 1 chunk for faster response');
  }
  
  // Create filtered embeddings map
  const filteredEmbeddings = new Map<string, number[]>();
  chunksToSearch.forEach(chunk => {
    const embedding = cache.chunkEmbeddings.get(chunk.id);
    if (embedding) {
      filteredEmbeddings.set(chunk.id, embedding);
    }
  });
  
  let lastProgressUpdate = 0;
  const searchResults = searchSimilarChunks(
    questionEmbedding,
    chunksToSearch,
    filteredEmbeddings,
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
  
  // If we filtered but got no results, fallback to full search
  if (searchResults.length === 0 && relevantComponentTypes.length > 0 && filteredChunks.length > 0) {
    eventLogger.warning('RAG Context', 'No results in filtered chunks, falling back to full search');
    const fallbackResults = searchSimilarChunks(
      questionEmbedding,
      cache.chunks,
      cache.chunkEmbeddings,
      topK,
      () => {}
    );
    if (fallbackResults.length > 0) {
      eventLogger.info('RAG Context', `✅ Fallback search found ${fallbackResults.length} chunk(s)`);
      // Merge results - prefer component chunks but include fallback
      searchResults.push(...fallbackResults);
      // Remove duplicates and re-sort
      const uniqueResults = new Map<string, SearchResult>();
      searchResults.forEach(r => {
        const existing = uniqueResults.get(r.chunk.id);
        if (!existing || r.similarity > existing.similarity) {
          uniqueResults.set(r.chunk.id, r);
        }
      });
      const mergedResults = Array.from(uniqueResults.values()).sort((a, b) => b.similarity - a.similarity).slice(0, topK);
      searchResults.length = 0;
      searchResults.push(...mergedResults);
    }
  }

  if (searchResults.length === 0) {
    eventLogger.warning('RAG Context', 'No relevant content found for question');
    return null;
  }

  // Retrieve context
  eventLogger.info('RAG Context', '📚 Stage 3: Preparing context from matched chunks...');
  const context = retrieveContext(searchResults, cache.chunks);
  
  // Enhance context with nested component chunks
  const componentResults = searchResults.filter(r => r.chunk.componentType && r.chunk.componentType !== 'text');
  if (componentResults.length > 0) {
    eventLogger.info('RAG Context', `✅ Found ${componentResults.length} component chunk(s) in search results`);
    
    // Add nested chunks (e.g., if we found a form, automatically include its nested input and button chunks)
    const nestedChunks: ContentChunk[] = [];
    componentResults.forEach(result => {
      // If chunk has nested chunks (e.g., form with inputs/buttons), add them to context
      if (result.chunk.nestedChunks && result.chunk.nestedChunks.length > 0) {
        result.chunk.nestedChunks.forEach(nestedChunk => {
          // Only add if not already in primary chunks
          if (!context.primaryChunks.find(c => c.id === nestedChunk.id)) {
            nestedChunks.push(nestedChunk);
          }
        });
        eventLogger.info('RAG Context', `📦 Form chunk contains ${result.chunk.nestedChunks.length} nested component(s) (inputs/buttons)`);
      }
    });
    
    // Add nested chunks to context if not already present
    nestedChunks.forEach(comp => {
      if (!context.primaryChunks.find(c => c.id === comp.id)) {
        context.primaryChunks.push(comp);
      }
    });
    
    if (nestedChunks.length > 0) {
      eventLogger.info('RAG Context', `📎 Added ${nestedChunks.length} nested component chunk(s) to context`);
    }
    
    // Log component details
    componentResults.forEach(r => {
      const comp = r.chunk.componentData;
      const nestedCount = r.chunk.nestedChunks?.length || 0;
      eventLogger.info('RAG Context', `  - ${r.chunk.componentType}: ${comp?.selector || 'N/A'} (score: ${r.similarity.toFixed(3)})${nestedCount > 0 ? ` [${nestedCount} nested components]` : ''}`);
      if (comp?.metadata.isInteractive) {
        eventLogger.debug('RAG Context', `    → Interactive component, can be used for actions`);
      }
      // Log nested components
      if (r.chunk.nestedChunks && r.chunk.nestedChunks.length > 0) {
        r.chunk.nestedChunks.forEach(nested => {
          eventLogger.debug('RAG Context', `    → Nested: ${nested.componentType} - ${nested.componentData?.selector || 'N/A'}`);
        });
      }
    });
  }
  
  eventLogger.info('RAG Context', `📄 Using ${context.primaryChunks.length} primary chunk${context.primaryChunks.length !== 1 ? 's' : ''} for answer`);
  context.primaryChunks.forEach((chunk, idx) => {
    const heading = chunk.metadata.heading || chunk.componentType || 'Introduction';
    const preview = chunk.content.substring(0, 100).replace(/\n/g, ' ');
    const componentInfo = chunk.componentType && chunk.componentType !== 'text' ? ` [${chunk.componentType}]` : '';
    eventLogger.info('RAG Context', `   ${idx + 1}. [${heading}${componentInfo}] "${preview}..."`);
  });
  
  eventLogger.info('RAG Context', '✅ Context ready with component-aware chunks');
  
  return {
    context,
    searchResults,
    cache,
  };
}

