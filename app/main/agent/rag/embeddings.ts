import { ContentChunk } from '../../../shared/types';
import { eventLogger } from '../../logging/event-logger';
import { getWorkerPool } from './worker-pool';

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
      
      // Set environment - allow remote models for first-time download
      if (transformers.env) {
        transformers.env.allowLocalModels = true;
        transformers.env.allowRemoteModels = true; // Allow downloading models
        transformers.env.remotePath = transformers.env.remotePath || 'https://huggingface.co';
      }
      
      eventLogger.info('Embeddings', `Loading model: ${MODEL_NAME}...`);
      eventLogger.info('Embeddings', 'This may take a moment on first run as the model downloads...');
      
      embeddingPipeline = await transformers.pipeline('feature-extraction', MODEL_NAME, {
        quantized: true, // Use quantized model for faster loading
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
  const embeddings = new Map<string, number[]>();

  eventLogger.info('Embeddings', `Starting embedding generation for ${chunks.length} chunks...`);
  eventLogger.info('Embeddings', 'This process converts text chunks into vector embeddings for semantic search');

  // Try to use worker pool, fallback to direct processing if it fails
  let useWorkers = false;
  let workerPool: any = null;
  let poolStats: any = null;
  let workerError: Error | null = null;

  try {
    eventLogger.info('Embeddings', 'Attempting to initialize worker pool...');
    workerPool = getWorkerPool();
    
    // Wait for all workers to initialize sequentially before using them
    eventLogger.info('Embeddings', 'Waiting for worker pool initialization...');
    await workerPool.waitForInitialization();
    
    poolStats = workerPool.getStats();
    useWorkers = poolStats.total > 0;
    if (useWorkers) {
      eventLogger.info('Embeddings', `All ${poolStats.total} worker threads initialized and ready for parallel processing`);
    } else {
      eventLogger.warning('Embeddings', 'Worker pool initialized but no workers available');
    }
  } catch (error: any) {
    workerError = error;
    eventLogger.error('Embeddings', `Worker pool initialization failed: ${error.message}`);
    eventLogger.error('Embeddings', `Error stack: ${error.stack || 'No stack trace'}`);
    eventLogger.warning('Embeddings', 'Falling back to direct processing');
    useWorkers = false;
  }

  const totalChunks = chunks.length;
  let completedCount = 0;
  let failedCount = 0;
  
  // Emit initial progress event
  if (progressCallback) {
    progressCallback({ current: 0, total: totalChunks });
  }
  
  // Log which method we're using
  if (useWorkers && workerPool) {
    eventLogger.info('Embeddings', `Using ${poolStats.total} worker threads - processing all ${totalChunks} chunks in parallel`);
  } else {
    eventLogger.warning('Embeddings', 'Using direct processing (sequential) - workers not available');
    if (workerError) {
      eventLogger.error('Embeddings', `Worker error was: ${workerError.message}`);
    }
  }
  
  // Set progress callback on worker pool for batch-level progress updates
  if (useWorkers && workerPool && progressCallback) {
    eventLogger.debug('Embeddings', `Setting progress callback on worker pool: totalChunks=${totalChunks}`);
    workerPool.setProgressCallback(progressCallback, totalChunks);
  } else {
    eventLogger.warning('Embeddings', `Not setting progress callback: useWorkers=${useWorkers}, workerPool=${!!workerPool}, progressCallback=${!!progressCallback}`);
  }
  
  // Emit progress showing chunks are being queued
  if (useWorkers && workerPool && progressCallback) {
    // Show that we're queuing chunks
    eventLogger.info('Embeddings', `Queuing ${totalChunks} chunks to worker pool...`);
    progressCallback({ current: 0, total: totalChunks });
  }
  
  // Process chunks - use workers if available, otherwise use direct processing
  // All chunks start processing immediately (parallel), but workers handle the actual parallelism
  const embeddingPromises = chunks.map(async (chunk, index) => {
    let retries = 2;
    
    while (retries > 0) {
      try {
        let embedding: number[];
        
        if (useWorkers && workerPool) {
          // Use worker thread - this is truly parallel across workers
          // Progress is now handled at batch level, not per-chunk
          eventLogger.debug('Embeddings', `Submitting chunk ${index + 1}/${totalChunks} to worker pool`);
          embedding = await workerPool.generateEmbedding(chunk.id, chunk.content);
        } else {
          // Fallback to direct processing - this is sequential CPU work
          embedding = await generateEmbedding(chunk.content);
          completedCount++;
          
          // Update progress for direct processing (no workers)
          if (progressCallback) {
            throttledProgressCallback(progressCallback, { current: completedCount, total: totalChunks });
          }
        }
        
        embeddings.set(chunk.id, embedding);
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
  
  // Wait for all embeddings to complete - all started in parallel
  eventLogger.info('Embeddings', `Started ${embeddingPromises.length} embedding tasks in parallel`);
  await Promise.all(embeddingPromises);
  
  // Final progress update
  // Ensure final progress is always emitted, even if throttled
  if (progressCallback) {
    // Clear any pending throttle
    if (progressThrottleTimeout) {
      clearTimeout(progressThrottleTimeout);
      progressThrottleTimeout = null;
    }
    progressCallback({ current: totalChunks, total: totalChunks });
  }

  const processingTime = Date.now() - startTime;
  const successRate = ((embeddings.size / chunks.length) * 100).toFixed(1);
  const avgTimePerChunk = (processingTime / chunks.length).toFixed(1);
  const chunksPerSecond = ((chunks.length / processingTime) * 1000).toFixed(1);
  
  eventLogger.success('Embeddings', `Generated ${embeddings.size} out of ${chunks.length} embeddings (${successRate}% success) in ${processingTime}ms`);
  eventLogger.info('Embeddings', `Performance: ${chunksPerSecond} chunks/sec, ${avgTimePerChunk}ms avg per chunk`);
  eventLogger.info('Embeddings', 'Embeddings are now ready for semantic similarity search');
  
  if (failedCount > 0) {
    eventLogger.warning('Embeddings', `${failedCount} chunks failed to generate embeddings`);
  }
  
  return embeddings;
}

