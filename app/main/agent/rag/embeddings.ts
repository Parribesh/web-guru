import { ContentChunk } from '../../../shared/types';
import { eventLogger } from '../../logging/event-logger';
import { getEmbeddingService } from './embedding-service';

// Lazy load the embedding model
let embeddingPipeline: any = null;
let transformersModule: any = null;
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2'; // Fast, lightweight sentence transformer

async function loadTransformers(): Promise<any> {
  if (transformersModule) {
    return transformersModule;
  }
  
  // Dynamic import for ES module - use eval to prevent TypeScript from transpiling to require()
  // This is necessary because @xenova/transformers is an ES module and can't be required
  const importExpr = 'import("@xenova/transformers")';
  transformersModule = await eval(importExpr);
  return transformersModule;
}

let isInitializing = false;
let initPromise: Promise<void> | null = null;

export async function initializeEmbeddings(): Promise<void> {
  if (embeddingPipeline) {
    return;
  }

  // Prevent multiple simultaneous initialization attempts
  if (isInitializing && initPromise) {
    return initPromise;
  }

  isInitializing = true;
  initPromise = (async () => {
    eventLogger.info('Embeddings', 'Initializing sentence transformer embeddings...');
    try {
      const transformers = await loadTransformers();
      eventLogger.info('Embeddings', 'Loading transformers module...');
      
      // Configure transformers environment for optimal caching
      const path = await import('path');
      const os = await import('os');
      const fs = await import('fs');
      
      if (transformers.env) {
        transformers.env.allowLocalModels = true;
        transformers.env.allowRemoteModels = true; // Allow downloading models
        transformers.env.remotePath = transformers.env.remotePath || 'https://huggingface.co';
        
        // transformers.js automatically caches models in ~/.cache/huggingface/transformers
        // We ensure this directory exists and log cache status
        const defaultCacheDir = path.join(os.homedir(), '.cache', 'huggingface', 'transformers');
        const cacheDir = process.env.TRANSFORMERS_CACHE || defaultCacheDir;
        
        // Ensure cache directory exists (transformers.js will create it, but we ensure it's ready)
        try {
          if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
            eventLogger.info('Embeddings', `Created transformers cache directory: ${cacheDir}`);
          }
        } catch (err: any) {
          eventLogger.warning('Embeddings', `Could not create cache directory ${cacheDir}: ${err.message}`);
        }
        
        // Note: transformers.js automatically uses this cache directory
        // Models are cached after first download and reused automatically
        eventLogger.info('Embeddings', `Transformers cache directory: ${cacheDir}`);
      }
      
      // Check if model is already cached
      const cacheDir = process.env.TRANSFORMERS_CACHE || 
                      path.join(os.homedir(), '.cache', 'huggingface', 'transformers');
      const modelCachePath = path.join(cacheDir, 'models--' + MODEL_NAME.replace('/', '--'));
      const isCached = fs.existsSync(modelCachePath);
      
      if (isCached) {
        eventLogger.info('Embeddings', `Model found in cache: ${MODEL_NAME} (loading from cache)`);
      } else {
        eventLogger.info('Embeddings', `Model not in cache: ${MODEL_NAME} (will download and cache)`);
        eventLogger.info('Embeddings', 'This may take a moment on first run as the model downloads...');
      }
      
      embeddingPipeline = await transformers.pipeline('feature-extraction', MODEL_NAME, {
        quantized: true, // Use quantized model for faster loading and smaller cache size
        revision: 'main', // Use main branch for consistency
        progress_callback: (progress: any) => {
          // Log progress if available
          if (progress && progress.status === 'progress') {
            const percent = progress.progress ? Math.round(progress.progress * 100) : 0;
            if (percent > 0 && percent % 10 === 0) { // Log every 10%
              eventLogger.info('Embeddings', `Downloading model: ${percent}%`);
            }
          }
        },
      });
      
      if (!isCached) {
        eventLogger.info('Embeddings', `Model cached for future use at: ${modelCachePath}`);
      }
      eventLogger.success('Embeddings', 'Embeddings initialized successfully');
    } catch (error: any) {
      eventLogger.error('Embeddings', 'Failed to initialize embeddings', error.message || error);
      // Check if it's an EPIPE error (broken pipe)
      if (error.code === 'EPIPE' || error.message?.includes('EPIPE')) {
        eventLogger.warning('Embeddings', 'EPIPE error detected - this may be due to model download');
        // Reset and allow retry
        embeddingPipeline = null;
        throw new Error('Model initialization failed. Please ensure you have internet connection for first-time model download.');
      }
      throw error;
    } finally {
      isInitializing = false;
      initPromise = null;
    }
  })();

  return initPromise;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  // Wait for initialization if in progress
  if (isInitializing && initPromise) {
    await initPromise;
  } else if (!embeddingPipeline) {
    await initializeEmbeddings();
  }

  if (!embeddingPipeline) {
    throw new Error('Embedding pipeline not initialized');
  }

  try {
    const output = await embeddingPipeline(text, {
      pooling: 'mean',
      normalize: true,
    });

    // Convert tensor to array
    const embedding = Array.from(output.data) as number[];
    
    // Validate embedding
    if (!embedding || embedding.length === 0) {
      throw new Error('Generated embedding is empty');
    }
    
    // Check if embedding has reasonable values (not all zeros or NaNs)
    const hasValidValues = embedding.some(v => !isNaN(v) && v !== 0);
    if (!hasValidValues) {
      throw new Error('Generated embedding contains only zeros or NaNs');
    }
    
    // Log embedding stats for debugging (first time only)
    if (Math.random() < 0.01) { // Log 1% of embeddings for debugging
      const min = Math.min(...embedding);
      const max = Math.max(...embedding);
      const mean = embedding.reduce((a, b) => a + b, 0) / embedding.length;
      const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
      eventLogger.debug('Embeddings', `Embedding stats: dim=${embedding.length}, min=${min.toFixed(4)}, max=${max.toFixed(4)}, mean=${mean.toFixed(4)}, norm=${norm.toFixed(4)}`);
    }
    
    return embedding;
  } catch (error) {
    console.error('❌ Failed to generate embedding:', error);
    eventLogger.error('Embeddings', `Failed to generate embedding for text: "${text.substring(0, 50)}..."`, error instanceof Error ? error.message : String(error));
    // Reset pipeline on error to allow retry
    embeddingPipeline = null;
    throw error;
  }
}

// Throttle progress callbacks to prevent bursts
let lastProgressTime = 0;
let lastProgressValue = { current: 0, total: 0 };
let progressThrottleTimeout: NodeJS.Timeout | null = null;
const PROGRESS_THROTTLE_MS = 50; // Emit progress at most every 50ms

function throttledProgressCallback(
  callback: (progress: { current: number; total: number }) => void,
  progress: { current: number; total: number }
) {
  lastProgressValue = progress;
  const now = Date.now();
  
  // If enough time has passed, call immediately
  if (now - lastProgressTime >= PROGRESS_THROTTLE_MS) {
    lastProgressTime = now;
    callback(progress);
    
    // Clear any pending timeout
    if (progressThrottleTimeout) {
      clearTimeout(progressThrottleTimeout);
      progressThrottleTimeout = null;
    }
  } else {
    // Schedule a delayed call if not already scheduled
    // CRITICAL: Always schedule the timeout to ensure progress is emitted
    // This prevents gaps when chunks complete in parallel
    if (!progressThrottleTimeout) {
      const delay = Math.max(1, PROGRESS_THROTTLE_MS - (now - lastProgressTime));
      progressThrottleTimeout = setTimeout(() => {
        lastProgressTime = Date.now();
        callback(lastProgressValue);
        progressThrottleTimeout = null;
        
        // If there's a newer progress value queued, schedule another update immediately
        // This ensures continuous progress updates even during parallel batch processing
        if (lastProgressValue.current !== progress.current || lastProgressValue.total !== progress.total) {
          // Progress has advanced, schedule another update
          const newDelay = PROGRESS_THROTTLE_MS;
          progressThrottleTimeout = setTimeout(() => {
            lastProgressTime = Date.now();
            callback(lastProgressValue);
            progressThrottleTimeout = null;
          }, newDelay);
        }
      }, delay);
    }
  }
}

export async function generateChunkEmbeddings(
  chunks: ContentChunk[],
  progressCallback?: (progress: { current: number; total: number }) => void
): Promise<Map<string, number[]>> {
  const startTime = Date.now();
  
  console.log(`[Embeddings] Starting embedding generation for ${chunks.length} chunks...`);
  eventLogger.info('Embeddings', `Starting embedding generation for ${chunks.length} chunks...`);
  eventLogger.info('Embeddings', 'This process converts text chunks into vector embeddings for semantic search via HTTP service');

  // Use HTTP-based embedding service
  const embeddingService = getEmbeddingService();
  const serviceBaseUrl = (embeddingService as any).baseUrl;
  
  // Check if service is available
  console.log(`[Embeddings] Checking embedding service availability at ${serviceBaseUrl}...`);
  eventLogger.info('Embeddings', `Checking embedding service availability at ${serviceBaseUrl}...`);
  const isAvailable = await embeddingService.healthCheck();
  console.log(`[Embeddings] Health check result: ${isAvailable}`);
  
  if (!isAvailable) {
    console.warn(`[Embeddings] HTTP embedding service not available, falling back to direct processing`);
    eventLogger.warning('Embeddings', 'HTTP embedding service not available, falling back to direct processing');
    eventLogger.warning('Embeddings', `Service URL was: ${serviceBaseUrl}`);
    // Fallback to direct processing
    return generateChunkEmbeddingsDirect(chunks, progressCallback);
  }

  console.log(`[Embeddings] Service is available, submitting ${chunks.length} chunks for embedding generation`);
  eventLogger.info('Embeddings', `Service is available, submitting ${chunks.length} chunks for embedding generation`);
  try {
    // Use HTTP service to generate embeddings
    console.log(`[Embeddings] Calling embeddingService.generateEmbeddings with ${chunks.length} chunks`);
    const embeddings = await embeddingService.generateEmbeddings(
      chunks.map(chunk => ({ id: chunk.id, content: chunk.content })),
      progressCallback
    );
    console.log(`[Embeddings] Received ${embeddings.size} embeddings from service`);

    const processingTime = Date.now() - startTime;
    const successRate = ((embeddings.size / chunks.length) * 100).toFixed(1);
    const avgTimePerChunk = (processingTime / chunks.length).toFixed(1);
    const chunksPerSecond = ((chunks.length / processingTime) * 1000).toFixed(1);
    
    eventLogger.success('Embeddings', `Generated ${embeddings.size} out of ${chunks.length} embeddings (${successRate}% success) in ${processingTime}ms`);
    eventLogger.info('Embeddings', `Performance: ${chunksPerSecond} chunks/sec, ${avgTimePerChunk}ms avg per chunk`);
    eventLogger.info('Embeddings', 'Embeddings are now ready for semantic similarity search');
    
    return embeddings;
  } catch (error: any) {
    eventLogger.error('Embeddings', `HTTP embedding service failed: ${error.message}`);
    eventLogger.warning('Embeddings', 'Falling back to direct processing');
    return generateChunkEmbeddingsDirect(chunks, progressCallback);
  }
}

/**
 * Fallback: Generate embeddings directly (for when HTTP service is unavailable)
 */
async function generateChunkEmbeddingsDirect(
  chunks: ContentChunk[],
  progressCallback?: (progress: { current: number; total: number }) => void
): Promise<Map<string, number[]>> {
  const startTime = Date.now();
  const embeddings = new Map<string, number[]>();
  const totalChunks = chunks.length;
  let completedCount = 0;
  let failedCount = 0;

  eventLogger.info('Embeddings', `Using direct processing for ${totalChunks} chunks (fallback mode)`);
  
  if (progressCallback) {
    progressCallback({ current: 0, total: totalChunks });
  }

  const embeddingPromises = chunks.map(async (chunk) => {
    let retries = 2;
    
    while (retries > 0) {
      try {
        const embedding = await generateEmbedding(chunk.content);
        completedCount++;
        embeddings.set(chunk.id, embedding);
        
        if (progressCallback) {
          throttledProgressCallback(progressCallback, { current: completedCount, total: totalChunks });
        }
        
        return { success: true, chunkId: chunk.id };
      } catch (error: any) {
        retries--;
        
        if (retries > 0) {
          eventLogger.warning('Embeddings', `Failed to generate embedding for chunk ${chunk.id}, retrying... (${retries} retries left)`);
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          eventLogger.error('Embeddings', `Failed to generate embedding for chunk ${chunk.id} after retries`, error.message || error);
          failedCount++;
          return { success: false, chunkId: chunk.id };
        }
      }
    }
    
    return { success: false, chunkId: chunk.id };
  });
  
  await Promise.all(embeddingPromises);
  
  if (progressCallback) {
    if (progressThrottleTimeout) {
      clearTimeout(progressThrottleTimeout);
      progressThrottleTimeout = null;
    }
    progressCallback({ current: totalChunks, total: totalChunks });
  }

  const processingTime = Date.now() - startTime;
  const successRate = ((embeddings.size / chunks.length) * 100).toFixed(1);
  
  eventLogger.success('Embeddings', `Generated ${embeddings.size} out of ${chunks.length} embeddings (${successRate}% success) in ${processingTime}ms`);
  
  if (failedCount > 0) {
    eventLogger.warning('Embeddings', `${failedCount} chunks failed to generate embeddings`);
  }
  
  return embeddings;
}

