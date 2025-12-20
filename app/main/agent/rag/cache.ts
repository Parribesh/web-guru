// Content Cache Management

import { ContentChunk, PageContent } from '../../../shared/types';
import { chunkContent, extractStructure } from './chunking';
import { eventLogger } from '../../logging/event-logger';

// Lazy import embeddings to avoid ES module issues at startup
let embeddingsModule: any = null;
async function getEmbeddingsModule() {
  if (!embeddingsModule) {
    embeddingsModule = await import('./embeddings');
  }
  return embeddingsModule;
}

// Per-tab cache for page content and embeddings
export interface TabCache {
  pageContent: PageContent;
  chunks: ContentChunk[];
  chunkEmbeddings: Map<string, number[]>;
  cachedAt: number;
}

const tabCache = new Map<string, TabCache>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export async function cachePageContent(
  tabId: string,
  extractedText: string,
  htmlContent: string,
  url: string,
  title: string
): Promise<void> {
  const startTime = Date.now();
  eventLogger.info('RAG Cache', `Caching page content for tab ${tabId}: ${title}`);
  eventLogger.info('RAG Cache', `URL: ${url}`);

  // Extract structure
  eventLogger.info('RAG Cache', 'Extracting page structure...');
  const structure = extractStructure(htmlContent, extractedText);
  eventLogger.success('RAG Cache', `Extracted ${structure.sections.length} sections`);

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

  eventLogger.info('RAG Cache', `Page has ${pageContent.metadata.wordCount} words`);

  // Chunk the content
  eventLogger.info('RAG Cache', 'Chunking page content...');
  const chunks = chunkContent(pageContent);
  eventLogger.success('RAG Cache', `Created ${chunks.length} content chunks`);
  
  // Log summary of chunks
  const chunksWithContent = chunks.filter(c => c.content && c.content.trim().length > 0);
  const chunksWithoutContent = chunks.length - chunksWithContent.length;
  if (chunksWithoutContent > 0) {
    eventLogger.warning('RAG Cache', `${chunksWithoutContent} chunks have no content!`);
  }
  eventLogger.info('RAG Cache', `Chunks with content: ${chunksWithContent.length}/${chunks.length}`);
  
  // Log first few chunks for debugging
  chunks.slice(0, 3).forEach((chunk, idx) => {
    const preview = chunk.content ? chunk.content.substring(0, 100).replace(/\n/g, ' ') : 'NO CONTENT';
    eventLogger.debug('RAG Cache', `Chunk ${idx + 1}: "${chunk.metadata.heading || 'No heading'}" - ${chunk.content?.length || 0} chars - "${preview}..."`);
  });

  // Generate embeddings (lazy load module)
  eventLogger.info('RAG Cache', `Generating embeddings for ${chunks.length} chunks...`);
  eventLogger.info('RAG Cache', 'This may take a moment...');
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
  eventLogger.success('RAG Cache', `Cached ${chunks.length} chunks with embeddings for tab ${tabId} in ${processingTime}ms`);
  eventLogger.info('RAG Cache', `Embeddings ready for semantic search on this page`);
}

export function getCachedContent(tabId: string): TabCache | null {
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

export function clearCache(tabId?: string): void {
  if (tabId) {
    tabCache.delete(tabId);
    console.log(`🗑️ Cleared cache for tab ${tabId}`);
  } else {
    tabCache.clear();
    console.log('🗑️ Cleared all caches');
  }
}

