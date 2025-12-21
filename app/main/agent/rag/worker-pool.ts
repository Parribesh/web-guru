// Worker Pool Manager for Embedding Generation

import { Worker } from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import { eventLogger } from '../../logging/event-logger';

interface WorkerTask {
  chunkId: string;
  text: string;
  resolve: (embedding: number[]) => void;
  reject: (error: Error) => void;
}

interface BatchTask {
  tasks: WorkerTask[];
  batchId: string;
}

interface WorkerState {
  worker: Worker;
  busy: boolean;
  taskQueue: WorkerTask[];
  currentTask: BatchTask | null;
  ready: boolean; // Track if worker has initialized and is ready
  pendingBatches: Map<string, BatchTask>; // Track batches by batchId
}

export class EmbeddingWorkerPool {
  private workers: WorkerState[] = [];
  private taskQueue: WorkerTask[] = [];
  private readonly poolSize: number;
  private readonly workerPath: string;
  private initializationPromise: Promise<void> | null = null;
  private isInitialized: boolean = false;
  private readonly batchSize: number = 160; // Process 160 chunks per batch (doubled from 80 to further reduce IPC overhead)
  private progressCallback?: (progress: { current: number; total: number }) => void;
  private totalCompleted: number = 0;
  private totalChunks: number = 0;

  constructor(poolSize: number = 4) {
    this.poolSize = poolSize;
    // Get the worker file path - it will be compiled to JS in the output directory
    // __dirname points to dist/main/agent/rag/ when running compiled code
    this.workerPath = path.join(__dirname, 'embedding-worker.js');
    
    // Verify worker file exists
    if (!fs.existsSync(this.workerPath)) {
      throw new Error(`Worker file not found at: ${this.workerPath}. Make sure the TypeScript files are compiled.`);
    }
    
    // Initialize worker pool - store the promise so we can await it later
    this.initializationPromise = this.initializePool().catch((error) => {
      eventLogger.error('Worker Pool', `Failed to initialize worker pool: ${error.message}`);
      // Clear workers array to indicate failure
      this.workers = [];
      this.isInitialized = false;
      throw error;
    });
  }

  private async initializePool(): Promise<void> {
    eventLogger.info('Worker Pool', `Initializing ${this.poolSize} embedding workers...`);
    eventLogger.info('Worker Pool', `Worker path: ${this.workerPath}`);
    eventLogger.info('Worker Pool', `__dirname: ${__dirname}`);
    eventLogger.info('Worker Pool', `Current working directory: ${process.cwd()}`);
    
    // Check if file exists
    try {
      if (!fs.existsSync(this.workerPath)) {
        const errorMsg = `Worker file does not exist at: ${this.workerPath}`;
        eventLogger.error('Worker Pool', errorMsg);
        throw new Error(errorMsg);
      }
      eventLogger.info('Worker Pool', `Worker file exists, size: ${fs.statSync(this.workerPath).size} bytes`);
    } catch (error: any) {
      eventLogger.error('Worker Pool', `Error checking worker file: ${error.message}`);
      throw error;
    }
    
    // Initialize workers sequentially to avoid race conditions with transformers library
    for (let i = 0; i < this.poolSize; i++) {
      try {
        eventLogger.info('Worker Pool', `Creating worker ${i + 1}/${this.poolSize}...`);
        
        const worker = new Worker(this.workerPath, {
          workerData: { autoInit: false }, // Don't auto-init to avoid parallel initialization
          // Add resource limits to prevent crashes
          resourceLimits: {
            maxOldGenerationSizeMb: 512,
            maxYoungGenerationSizeMb: 256,
          }
        });

        const workerState: WorkerState = {
          worker,
          busy: false,
          taskQueue: [],
          currentTask: null,
          ready: false,
          pendingBatches: new Map()
        };

        // Set up message handler with timeout for initialization
        let initTimeout: NodeJS.Timeout | null = null;
        let initResolve: ((value: void) => void) | null = null;
        let initReject: ((error: Error) => void) | null = null;
        const initPromise = new Promise<void>((resolve, reject) => {
          initResolve = resolve;
          initReject = reject;
          
          // Set timeout for initialization
          initTimeout = setTimeout(() => {
            eventLogger.error('Worker Pool', `Worker ${i} failed to initialize within 60 seconds`);
            reject(new Error(`Worker ${i} initialization timeout`));
          }, 60000); // Increased timeout to 60 seconds for model loading
        });
        
        worker.on('message', (message: any) => {
          if (message.type === 'ready') {
            if (initTimeout) {
              clearTimeout(initTimeout);
              initTimeout = null;
            }
            if (initResolve) {
              workerState.ready = true;
              initResolve();
              initResolve = null;
              initReject = null;
            }
            eventLogger.info('Worker Pool', `Worker ${i} initialized successfully and ready`);
          } else if (message.type === 'error') {
            if (initTimeout) {
              clearTimeout(initTimeout);
              initTimeout = null;
            }
            if (initReject) {
              const error = new Error(message.error || 'Worker initialization error');
              initReject(error);
              initResolve = null;
              initReject = null;
            }
            eventLogger.error('Worker Pool', `Worker ${i} reported error during initialization: ${message.error}`);
          }
          
          // Only handle other messages if worker is ready
          if (workerState.ready) {
            this.handleWorkerMessage(i, message);
          }
        });

        worker.on('error', (error) => {
          if (initTimeout) {
            clearTimeout(initTimeout);
            initTimeout = null;
          }
          if (initReject) {
            initReject(error);
            initResolve = null;
            initReject = null;
          }
          eventLogger.error('Worker Pool', `Worker ${i} error: ${error.message}`);
          eventLogger.error('Worker Pool', `Worker ${i} error stack: ${error.stack || 'No stack trace'}`);
          eventLogger.error('Worker Pool', `Worker ${i} error name: ${error.name}`);
          console.error(`[Worker Pool] Worker ${i} full error:`, error);
          
          // Only handle worker errors if worker was already ready
          if (workerState.ready) {
            this.handleWorkerError(i, error);
          }
        });

        worker.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
          if (initTimeout) {
            clearTimeout(initTimeout);
            initTimeout = null;
          }
          if (initReject) {
            const error = new Error(`Worker ${i} exited during initialization with code ${code}, signal ${signal || 'none'}`);
            initReject(error);
            initResolve = null;
            initReject = null;
          }
          
          if (code !== 0 || signal) {
            eventLogger.error('Worker Pool', `Worker ${i} exited with code ${code}, signal: ${signal || 'none'}`);
            eventLogger.error('Worker Pool', `This indicates a crash or abnormal termination`);
            // Don't restart immediately - log the issue
            if (code === null && signal === 'SIGTRAP') {
              eventLogger.error('Worker Pool', `Worker ${i} crashed with SIGTRAP - this is a debugger trap or serious error`);
            }
          } else {
            eventLogger.info('Worker Pool', `Worker ${i} exited normally`);
          }
        });

        this.workers.push(workerState);
        eventLogger.info('Worker Pool', `Worker ${i} created, sending init message...`);
        
        // Send init message to worker and wait for it to be ready
        worker.postMessage({ type: 'init' });
        
        // Wait for this worker to initialize before creating the next one
        try {
          await initPromise;
          eventLogger.info('Worker Pool', `Worker ${i} is ready (${i + 1}/${this.poolSize} initialized)`);
        } catch (error: any) {
          eventLogger.error('Worker Pool', `Worker ${i} failed to initialize: ${error.message}`);
          worker.terminate();
          // Remove failed worker from array
          this.workers.pop();
          throw error;
        }
      } catch (error: any) {
        eventLogger.error('Worker Pool', `Failed to create worker ${i}: ${error.message}`);
        eventLogger.error('Worker Pool', `Error type: ${error.constructor.name}`);
        eventLogger.error('Worker Pool', `Error stack: ${error.stack || 'No stack trace'}`);
        console.error(`[Worker Pool] Full error creating worker ${i}:`, error);
        
        // If we can't create any workers, throw to indicate failure
        if (i === 0) {
          throw new Error(`Failed to initialize worker pool: ${error.message}. Stack: ${error.stack}`);
        }
      }
    }

    if (this.workers.length === 0) {
      const errorMsg = 'Failed to create any workers';
      eventLogger.error('Worker Pool', errorMsg);
      throw new Error(errorMsg);
    }

    this.isInitialized = true;
    eventLogger.success('Worker Pool', `All ${this.workers.length} workers initialized and ready`);
  }
  
  async waitForInitialization(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    
    if (!this.initializationPromise) {
      throw new Error('Worker pool initialization not started');
    }
    
    await this.initializationPromise;
  }

  private handleWorkerMessage(workerIndex: number, message: any): void {
    const workerState = this.workers[workerIndex];
    
    // Ignore messages from workers that aren't ready (shouldn't happen, but safety check)
    if (!workerState.ready && message.type !== 'ready') {
      eventLogger.warning('Worker Pool', `Received ${message.type} message from uninitialized worker ${workerIndex}`);
      return;
    }

    if (message.type === 'ready') {
      // This should have been handled during initialization, but handle it here too
      workerState.ready = true;
      workerState.busy = false;
      this.processNextTask(workerIndex);
    } else if (message.type === 'embedding') {
      // Single embedding response (for backward compatibility - shouldn't happen with batching)
      // This is kept for safety but batch processing should be used
      const batch = workerState.currentTask;
      if (batch && batch.tasks && batch.tasks.length === 1 && batch.tasks[0].chunkId === message.data.chunkId) {
        batch.tasks[0].resolve(message.data.embedding);
        if (batch.batchId) {
          workerState.pendingBatches.delete(batch.batchId);
        }
        workerState.currentTask = null;
        workerState.busy = false;
        this.processNextTask(workerIndex);
      }
    } else if (message.type === 'batch') {
      // Final batch completion message - all chunks are done
      const batch = workerState.pendingBatches.get(message.batchId);
      if (batch) {
        const embeddings = message.data.embeddings as Array<{ chunkId: string; embedding: number[] }>;
        const errors = message.data.errors as Array<{ chunkId: string; error: string }> || [];
        const completed = message.data.completed as number || embeddings.length;
        const total = message.data.total as number || batch.tasks.length;
        
        eventLogger.debug('Worker Pool', `Worker ${workerIndex} completed batch ${message.batchId}: ${embeddings.length} success, ${errors.length} errors`);
        
        // Resolve all successful embeddings
        for (const emb of embeddings) {
          const task = batch.tasks.find(t => t.chunkId === emb.chunkId);
          if (task) {
            task.resolve(emb.embedding);
          }
        }
        
        // Reject all failed embeddings
        for (const err of errors) {
          const task = batch.tasks.find(t => t.chunkId === err.chunkId);
          if (task) {
            task.reject(new Error(err.error));
          }
        }
        
        // Emit progress event for this batch completion
        // This is the simplified approach: one event per batch per worker
        this.totalCompleted += completed;
        if (this.progressCallback && this.totalChunks > 0) {
          // Use setImmediate to ensure progress callback doesn't block batch processing
          setImmediate(() => {
            eventLogger.debug('Worker Pool', `Emitting progress: ${this.totalCompleted}/${this.totalChunks} (batch completed: ${completed} chunks)`);
            this.progressCallback!({ 
              current: this.totalCompleted, 
              total: this.totalChunks
            });
          });
        } else {
          eventLogger.warning('Worker Pool', `Progress callback not set or totalChunks is 0. Completed: ${this.totalCompleted}, Total: ${this.totalChunks}, Callback: ${!!this.progressCallback}`);
        }
        
        workerState.pendingBatches.delete(message.batchId);
        workerState.currentTask = null;
        workerState.busy = false;
        
        // Use setImmediate to ensure processNextTask runs after current batch cleanup
        // This prevents delays and ensures smooth task processing
        // Process if we have enough tasks for a full batch, OR if all workers are idle with remaining tasks
        setImmediate(() => {
          const allWorkersIdle = this.workers.every(w => !w.busy || w.taskQueue.length === 0);
          const hasRemainingTasks = workerState.taskQueue.length > 0;
          if (workerState.taskQueue.length >= this.batchSize || (allWorkersIdle && hasRemainingTasks)) {
            this.processNextTask(workerIndex);
          }
        });
      } else {
        eventLogger.warning('Worker Pool', `Received batch response for unknown batchId: ${message.batchId}`);
      }
    } else if (message.type === 'error') {
      // Log crash report if present
      if (message.crashReport) {
        eventLogger.error('Worker Pool', `Worker ${workerIndex} crash report:`, message.crashReport);
        console.error(`[Worker Pool] Worker ${workerIndex} crash report:`, message.crashReport);
      }
      
      const batch = workerState.currentTask;
      if (batch) {
        const errorMsg = message.error || 'Unknown worker error';
        eventLogger.error('Worker Pool', `Worker ${workerIndex} error: ${errorMsg}`);
        // Reject all tasks in the batch
        for (const task of batch.tasks) {
          task.reject(new Error(errorMsg));
        }
        if (batch.batchId) {
          workerState.pendingBatches.delete(batch.batchId);
        }
        workerState.currentTask = null;
        workerState.busy = false;
        
        // Use setImmediate to ensure processNextTask runs after error cleanup
        // Process if we have enough tasks for a full batch, OR if all workers are idle with remaining tasks
        setImmediate(() => {
          const allWorkersIdle = this.workers.every(w => !w.busy || w.taskQueue.length === 0);
          const hasRemainingTasks = workerState.taskQueue.length > 0;
          if (workerState.taskQueue.length >= this.batchSize || (allWorkersIdle && hasRemainingTasks)) {
            this.processNextTask(workerIndex);
          }
        });
      }
    }
  }

  private handleWorkerError(workerIndex: number, error: Error): void {
    const workerState = this.workers[workerIndex];
    const batch = workerState.currentTask;
    
    if (batch) {
      // Reject all tasks in the batch
      for (const task of batch.tasks) {
        task.reject(error);
      }
      // Remove from pending batches if it has a batchId
      if (batch.batchId) {
        workerState.pendingBatches.delete(batch.batchId);
      }
      workerState.currentTask = null;
      workerState.busy = false;
    }
    
    // Restart worker
    this.restartWorker(workerIndex);
  }

  private restartWorker(workerIndex: number): void {
    const oldWorker = this.workers[workerIndex].worker;
    oldWorker.terminate();

    try {
      const worker = new Worker(this.workerPath, {
        workerData: { autoInit: true }
      });

      const workerState: WorkerState = {
        worker,
        busy: false,
        taskQueue: [],
        currentTask: null,
        ready: false,
        pendingBatches: new Map()
      };

      worker.on('message', (message: any) => {
        this.handleWorkerMessage(workerIndex, message);
      });

      worker.on('error', (error) => {
        this.handleWorkerError(workerIndex, error);
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          this.restartWorker(workerIndex);
        }
      });

      this.workers[workerIndex] = workerState;
      eventLogger.info('Worker Pool', `Restarted worker ${workerIndex}`);
    } catch (error: any) {
      eventLogger.error('Worker Pool', `Failed to restart worker ${workerIndex}: ${error.message}`);
    }
  }

  private processNextTask(workerIndex: number): void {
    const workerState = this.workers[workerIndex];
    
    // Don't process tasks if worker isn't ready
    if (!workerState.ready || workerState.busy || workerState.taskQueue.length === 0) {
      return;
    }

    // Check if all workers are idle and there are remaining tasks
    // This handles the case where remaining chunks < batchSize
    const allWorkersIdle = this.workers.every(w => !w.busy || w.taskQueue.length === 0);
    const hasRemainingTasks = workerState.taskQueue.length > 0;
    const shouldProcessRemaining = allWorkersIdle && hasRemainingTasks;

    // Wait until we have at least batchSize tasks, UNLESS all workers are idle
    // This ensures workers start with full batches, but also processes remaining chunks
    if (workerState.taskQueue.length < this.batchSize && !shouldProcessRemaining) {
      // Not enough tasks yet, wait for more
      return;
    }

    // Collect a batch of tasks (up to batchSize, or all remaining if processing final chunks)
    const batchTasks: WorkerTask[] = [];
    const batchSizeToProcess = shouldProcessRemaining 
      ? workerState.taskQueue.length  // Process all remaining tasks
      : this.batchSize;                // Process exactly batchSize
    
    for (let i = 0; i < batchSizeToProcess; i++) {
      const task = workerState.taskQueue.shift();
      if (task) {
        batchTasks.push(task);
      }
    }
    
    if (batchTasks.length === 0) {
      return;
    }
    
    // Only require exact batchSize if we're not processing remaining tasks
    // When processing remaining tasks, allow any size batch
    if (batchTasks.length < this.batchSize && !shouldProcessRemaining) {
      // Put tasks back and wait for more
      batchTasks.forEach(task => workerState.taskQueue.unshift(task));
      return;
    }
    
    // Create batch
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const batch: BatchTask = {
      tasks: batchTasks,
      batchId
    };
    
    workerState.currentTask = batch;
    workerState.busy = true;
    workerState.pendingBatches.set(batchId, batch);

    // Send batch to worker
    eventLogger.debug('Worker Pool', `Worker ${workerIndex} processing batch ${batchId} with ${batchTasks.length} chunks`);
    
    // Note: Progress is only emitted when batches COMPLETE, not when they start
    // This ensures accurate progress reporting and avoids jumping/confusion
    // The slight delay before first progress update is acceptable for accuracy
    
    workerState.worker.postMessage({
      type: 'batch',
      batchId,
      data: {
        chunks: batchTasks.map(t => ({
          chunkId: t.chunkId,
          text: t.text
        }))
      }
    });
  }

  setProgressCallback(callback: (progress: { current: number; total: number }) => void, totalChunks: number): void {
    this.progressCallback = callback;
    this.totalChunks = totalChunks;
    this.totalCompleted = 0;
  }

  async generateEmbedding(chunkId: string, text: string): Promise<number[]> {
    // Ensure pool is initialized before accepting tasks
    await this.waitForInitialization();
    
    if (this.workers.length === 0) {
      throw new Error('No workers available');
    }
    
    return new Promise((resolve, reject) => {
      const task: WorkerTask = {
        chunkId,
        text,
        resolve,
        reject
      };

      // Find the least busy ready worker
      let leastBusyWorker = -1;
      let minQueueLength = Infinity;

      for (let i = 0; i < this.workers.length; i++) {
        const workerState = this.workers[i];
        if (!workerState.ready) {
          continue; // Skip uninitialized workers
        }
        
        const queueLength = workerState.taskQueue.length;
        if (queueLength < minQueueLength) {
          minQueueLength = queueLength;
          leastBusyWorker = i;
        }
      }
      
      if (leastBusyWorker === -1) {
        reject(new Error('No ready workers available'));
        return;
      }

      const workerState = this.workers[leastBusyWorker];
      workerState.taskQueue.push(task);
      
      // Call processNextTask if:
      // 1. Queue has enough tasks for a full batch, OR
      // 2. All workers are idle and there are remaining tasks (to process final chunks)
      const allWorkersIdle = this.workers.every(w => !w.busy || w.taskQueue.length === 0);
      const hasRemainingTasks = workerState.taskQueue.length > 0;
      if (workerState.taskQueue.length >= this.batchSize || (allWorkersIdle && hasRemainingTasks)) {
        this.processNextTask(leastBusyWorker);
      }
    });
  }

  async shutdown(): Promise<void> {
    eventLogger.info('Worker Pool', 'Shutting down worker pool...');
    
    const shutdownPromises = this.workers.map((workerState) => {
      return workerState.worker.terminate();
    });

    await Promise.all(shutdownPromises);
    this.workers = [];
    
    eventLogger.success('Worker Pool', 'Worker pool shut down');
  }

  getStats(): { total: number; busy: number; queueLength: number } {
    const busy = this.workers.filter(w => w.busy).length;
    const queueLength = this.workers.reduce((sum, w) => sum + w.taskQueue.length, 0);
    
    return {
      total: this.workers.length,
      busy,
      queueLength
    };
  }
}

// Singleton instance
let workerPool: EmbeddingWorkerPool | null = null;

export function getWorkerPool(poolSize?: number): EmbeddingWorkerPool {
  if (!workerPool) {
    // Use number of CPU cores, but cap at 16 to maximize parallelism
    const defaultPoolSize = poolSize || Math.min(require('os').cpus().length, 16);
    workerPool = new EmbeddingWorkerPool(defaultPoolSize);
  }
  return workerPool;
}

export async function shutdownWorkerPool(): Promise<void> {
  if (workerPool) {
    await workerPool.shutdown();
    workerPool = null;
  }
}

