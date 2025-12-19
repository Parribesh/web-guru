import { ContentChunk } from '../../shared/types';
import { eventLogger } from '../logging/event-logger';

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

export async function generateChunkEmbeddings(
  chunks: ContentChunk[]
): Promise<Map<string, number[]>> {
  const startTime = Date.now();
  const embeddings = new Map<string, number[]>();

  eventLogger.info('Embeddings', `Starting embedding generation for ${chunks.length} chunks...`);
  eventLogger.info('Embeddings', 'This process converts text chunks into vector embeddings for semantic search');

  // Process chunks with error handling and retry logic
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    let retries = 2;
    let success = false;
    
    while (retries > 0 && !success) {
      try {
        const embedding = await generateEmbedding(chunk.content);
        embeddings.set(chunk.id, embedding);
        success = true;
        
        // Log progress every chunk for real-time updates
        eventLogger.progress('Embeddings', `Generating embedding ${i + 1}/${chunks.length}...`, i + 1, chunks.length);
      } catch (error: any) {
        retries--;
        const isEPIPE = error.code === 'EPIPE' || error.message?.includes('EPIPE');
        
        if (isEPIPE && retries > 0) {
          eventLogger.warning('Embeddings', `EPIPE error for chunk ${i + 1}/${chunks.length}, retrying... (${retries} retries left)`);
          // Wait a bit before retry
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          eventLogger.error('Embeddings', `Failed to generate embedding for chunk ${i + 1}/${chunks.length} (ID: ${chunk.id})`, error.message || error);
          // Skip this chunk and continue
          break;
        }
      }
    }
  }

  const processingTime = Date.now() - startTime;
  const successRate = ((embeddings.size / chunks.length) * 100).toFixed(1);
  eventLogger.success('Embeddings', `Generated ${embeddings.size} out of ${chunks.length} embeddings (${successRate}% success) in ${processingTime}ms`);
  eventLogger.info('Embeddings', 'Embeddings are now ready for semantic similarity search');
  
  if (embeddings.size < chunks.length) {
    eventLogger.warning('Embeddings', `${chunks.length - embeddings.size} chunks failed to generate embeddings`);
  }
  
  return embeddings;
}

