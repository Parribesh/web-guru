// Content Cache Management

import { ContentChunk, PageContent, DOMComponent } from '../../../shared/types';
import { chunkContent, extractStructure } from './chunking';
import { extractComponents } from './components';
import { eventLogger } from '../../logging/event-logger';
// Persistent session storage disabled - only using in-memory cache for testing
// import { findSessionByUrl, saveSessionData } from './session-storage';

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
  components: DOMComponent[]; // Extracted DOM components
  cachedAt: number;
}

const tabCache = new Map<string, TabCache>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Track ongoing cache operations to prevent duplicate processing
const ongoingCacheOps = new Map<string, Promise<void>>();

export async function cachePageContent(
  tabId: string,
  extractedText: string,
  htmlContent: string,
  url: string,
  title: string,
  sessionId?: string
): Promise<void> {
  // Create a unique key for this cache operation (tabId + url to handle navigation)
  const cacheKey = `${tabId}:${url}`;
  
  // Check if there's already an ongoing cache operation for this tab+url
  const existingOp = ongoingCacheOps.get(cacheKey);
  if (existingOp) {
    eventLogger.info('RAG Cache', `Cache operation already in progress for tab ${tabId}: ${url}, waiting for completion...`);
    await existingOp;
    return;
  }
  
  // Check if we already have cached content for this URL (within TTL) - in-memory only
  // NOTE: Persistent session caching is disabled to allow testing of HTTP embedding service
  const existingCache = tabCache.get(cacheKey);
  if (existingCache && (Date.now() - existingCache.cachedAt) < CACHE_TTL) {
    console.log(`[RAG Cache] Content already cached in memory for tab ${tabId}: ${url} (cached ${Math.round((Date.now() - existingCache.cachedAt) / 1000)}s ago)`);
    eventLogger.info('RAG Cache', `Content already cached for tab ${tabId}: ${url} (cached ${Math.round((Date.now() - existingCache.cachedAt) / 1000)}s ago)`);
    return;
  }
  
  // Persistent session caching disabled - always generate fresh embeddings
  // This allows testing of HTTP embedding service
  console.log(`[RAG Cache] No cached content found, will generate fresh embeddings`);
  
  const startTime = Date.now();
  eventLogger.info('RAG Cache', `Caching page content for tab ${tabId}: ${title}`);
  eventLogger.info('RAG Cache', `URL: ${url}`);
  
  // Create the cache operation promise
  const cacheOp = (async () => {
    try {

      // Extract structure
      eventLogger.info('RAG Cache', 'Extracting page structure...');
      const structure = extractStructure(htmlContent, extractedText);
      eventLogger.success('RAG Cache', `Extracted ${structure.sections.length} sections`);

      // Extract components
      eventLogger.info('RAG Cache', 'Extracting DOM components...');
      const components = extractComponents(htmlContent, extractedText);
      eventLogger.success('RAG Cache', `Extracted ${components.length} components`);

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

      // Chunk the content (with components for component-aware chunking)
      // Make chunking async and emit progress events to avoid blocking the main thread
      eventLogger.info('RAG Cache', 'Chunking page content...');
      eventLogger.progress('RAG Cache', 'Starting chunking process...', 0, 100);
      
      // Process chunking in async batches to avoid blocking
      // Use setImmediate to yield control back to the event loop
      const chunks = await new Promise<ContentChunk[]>((resolve) => {
        setImmediate(() => {
          try {
            const chunks = chunkContent(pageContent, components);
            eventLogger.progress('RAG Cache', `Created ${chunks.length} chunks`, 50, 100);
            resolve(chunks);
          } catch (error) {
            eventLogger.error('RAG Cache', 'Chunking failed', error instanceof Error ? error.message : String(error));
            resolve([]);
          }
        });
      });
      
      eventLogger.success('RAG Cache', `Created ${chunks.length} content chunks (${chunks.filter(c => c.componentType !== 'text').length} component chunks)`);
      
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

      // Generate embeddings (lazy load module) with progress events
      console.log(`[RAG Cache] Generating embeddings for ${chunks.length} chunks...`);
      eventLogger.info('RAG Cache', `Generating embeddings for ${chunks.length} chunks...`);
      eventLogger.info('RAG Cache', 'This may take a moment...');
      eventLogger.progress('RAG Cache', 'Starting embedding generation...', 50, 100);
      
      const embeddingsModule = await getEmbeddingsModule();
      console.log(`[RAG Cache] Embeddings module loaded, calling generateChunkEmbeddings...`);
      
      // Generate embeddings with progress callback
      // Use setImmediate to yield control periodically during embedding generation
      const chunkEmbeddings = await new Promise<Map<string, number[]>>((resolve, reject) => {
        // Start embedding generation in next tick to avoid blocking
        setImmediate(async () => {
          try {
            console.log(`[RAG Cache] Starting embedding generation for ${chunks.length} chunks`);
            const embeddings = await embeddingsModule.generateChunkEmbeddings(chunks, (progress: { current: number; total: number }) => {
              const percentage = Math.round((progress.current / progress.total) * 50) + 50; // 50-100% range
              // Emit progress event immediately for EmbeddingProgress component
              // Use setImmediate to ensure event is processed even during heavy CPU work
              setImmediate(() => {
                eventLogger.progress('RAG Cache', `Generating embeddings: ${progress.current}/${progress.total}`, percentage, 100);
              });
            });
            console.log(`[RAG Cache] Embedding generation completed: ${embeddings.size} embeddings generated`);
            resolve(embeddings);
          } catch (error) {
            console.error(`[RAG Cache] Embedding generation failed:`, error);
            reject(error);
          }
        });
      });

      // Cache everything using tabId as key (for retrieval), but cacheKey is used for deduplication
      tabCache.set(tabId, {
        pageContent,
        chunks,
        chunkEmbeddings,
        components,
        cachedAt: Date.now(),
      });

      // Persistent session storage disabled - only using in-memory cache
      // This allows testing of HTTP embedding service without reusing old cached embeddings
      console.log(`[RAG Cache] Cached ${chunks.length} chunks with ${chunkEmbeddings.size} embeddings in memory (persistent storage disabled)`);

      const processingTime = Date.now() - startTime;
      eventLogger.success('RAG Cache', `Cached ${chunks.length} chunks with embeddings for tab ${tabId} in ${processingTime}ms`);
      eventLogger.info('RAG Cache', `Embeddings ready for semantic search on this page`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      eventLogger.error('RAG Cache', `Failed to cache page content for tab ${tabId}: ${errorMessage}`);
      throw error;
    } finally {
      // Remove from ongoing operations
      ongoingCacheOps.delete(cacheKey);
    }
  })();
  
  // Store the operation promise
  ongoingCacheOps.set(cacheKey, cacheOp);
  
  // Wait for completion
  await cacheOp;
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

