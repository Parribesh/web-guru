// Embedding Worker Thread
// This runs in a separate thread to avoid blocking the main thread

import { parentPort, workerData } from 'worker_threads';

// Worker-level error handling
process.on('uncaughtException', (error: Error) => {
  const errorReport = {
    type: 'worker_uncaughtException',
    message: error.message,
    stack: error.stack,
    name: error.name,
    timestamp: new Date().toISOString(),
  };
  
  console.error('[WORKER CRASH] Uncaught Exception:', errorReport);
  
  if (parentPort) {
    parentPort.postMessage({
      type: 'error',
      error: `Worker crashed: ${error.message}`,
      crashReport: errorReport
    });
  }
  
  // Exit after reporting
  process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
  const errorReport = {
    type: 'worker_unhandledRejection',
    reason: reason instanceof Error ? {
      message: reason.message,
      stack: reason.stack,
      name: reason.name,
    } : String(reason),
    timestamp: new Date().toISOString(),
  };
  
  console.error('[WORKER CRASH] Unhandled Rejection:', errorReport);
  
  if (parentPort) {
    parentPort.postMessage({
      type: 'error',
      error: `Worker unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
      crashReport: errorReport
    });
  }
});

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

interface WorkerMessage {
  type: 'init' | 'generate' | 'batch';
  data?: any;
  id?: string;
  batchId?: string;
}

interface WorkerResponse {
  type: 'ready' | 'embedding' | 'error' | 'progress' | 'batch';
  data?: any;
  id?: string;
  batchId?: string;
  error?: string;
}

let embeddingPipeline: any = null;
let transformersModule: any = null;

async function loadTransformers(): Promise<any> {
  if (transformersModule) {
    return transformersModule;
  }
  
  const importExpr = 'import("@xenova/transformers")';
  transformersModule = await eval(importExpr);
  return transformersModule;
}

async function initializeEmbeddings(): Promise<void> {
  if (embeddingPipeline) {
    return;
  }

  try {
    const transformers = await loadTransformers();
    
    if (transformers.env) {
      transformers.env.allowLocalModels = true;
      transformers.env.allowRemoteModels = true;
      transformers.env.remotePath = transformers.env.remotePath || 'https://huggingface.co';
    }
    
    embeddingPipeline = await transformers.pipeline('feature-extraction', MODEL_NAME, {
      quantized: true,
    });
  } catch (error: any) {
    throw new Error(`Failed to initialize embeddings in worker: ${error.message || error}`);
  }
}

async function generateEmbedding(text: string): Promise<number[]> {
  if (!embeddingPipeline) {
    await initializeEmbeddings();
  }

  const output = await embeddingPipeline(text, {
    pooling: 'mean',
    normalize: true,
  });

  const embedding = Array.from(output.data) as number[];
  
  if (!embedding || embedding.length === 0) {
    throw new Error('Generated embedding is empty');
  }
  
  const hasValidValues = embedding.some(v => !isNaN(v) && v !== 0);
  if (!hasValidValues) {
    throw new Error('Generated embedding contains only zeros or NaNs');
  }
  
  return embedding;
}

// Handle messages from main thread
parentPort?.on('message', async (message: WorkerMessage) => {
  try {
    switch (message.type) {
      case 'init':
        await initializeEmbeddings();
        // Warm up the model with a dummy inference to avoid slow first batch
        // This triggers JIT compilation, memory allocation, and model optimization
        try {
          await generateEmbedding('warmup');
          console.log('[Worker] Model warmed up successfully');
        } catch (error: any) {
          console.warn('[Worker] Model warmup failed (non-critical):', error.message);
          // Continue anyway - warmup failure doesn't prevent worker from being ready
        }
        parentPort?.postMessage({ type: 'ready' } as WorkerResponse);
        break;
        
      case 'generate':
        try {
          const embedding = await generateEmbedding(message.data.text);
          parentPort?.postMessage({
            type: 'embedding',
            id: message.id,
            data: { chunkId: message.data.chunkId, embedding }
          } as WorkerResponse);
        } catch (error: any) {
          parentPort?.postMessage({
            type: 'error',
            id: message.id,
            error: error.message || String(error)
          } as WorkerResponse);
        }
        break;
        
      case 'batch':
        try {
          const chunks = message.data.chunks as Array<{ chunkId: string; text: string }>;
          
          // Process all chunks in the batch IN PARALLEL
          const chunkPromises = chunks.map(async (chunk) => {
            try {
              const embedding = await generateEmbedding(chunk.text);
              return { success: true as const, chunkId: chunk.chunkId, embedding };
            } catch (error: any) {
              return { 
                success: false as const, 
                chunkId: chunk.chunkId, 
                error: error.message || String(error) 
              };
            }
          });
          
          // Wait for all chunks to complete in parallel
          const results = await Promise.all(chunkPromises);
          
          // Separate successes and errors
          const embeddings: Array<{ chunkId: string; embedding: number[] }> = [];
          const errors: Array<{ chunkId: string; error: string }> = [];
          
          for (const result of results) {
            if (result.success) {
              embeddings.push({ chunkId: result.chunkId, embedding: result.embedding });
            } else {
              errors.push({ chunkId: result.chunkId, error: result.error });
            }
          }
          
          // Send final batch completion message with progress info
          parentPort?.postMessage({
            type: 'batch',
            batchId: message.batchId,
            data: { 
              embeddings, 
              errors,
              completed: embeddings.length,
              total: chunks.length
            }
          } as WorkerResponse);
        } catch (error: any) {
          parentPort?.postMessage({
            type: 'error',
            batchId: message.batchId,
            error: error.message || String(error)
          } as WorkerResponse);
        }
        break;
        
      default:
        parentPort?.postMessage({
          type: 'error',
          error: `Unknown message type: ${message.type}`
        } as WorkerResponse);
    }
  } catch (error: any) {
    parentPort?.postMessage({
      type: 'error',
      error: error.message || String(error)
    } as WorkerResponse);
  }
});

// Signal that worker is ready (after initialization)
if (workerData?.autoInit !== false) {
  initializeEmbeddings().then(() => {
    parentPort?.postMessage({ type: 'ready' } as WorkerResponse);
  }).catch((error) => {
    parentPort?.postMessage({
      type: 'error',
      error: error.message || String(error)
    } as WorkerResponse);
  });
}

