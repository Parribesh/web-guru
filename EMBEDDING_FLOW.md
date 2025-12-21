# Complete Flow: DOM Extraction → Chunking → Embedding Generation

## Overview
This document explains the complete flow from DOM extraction to embedding generation, including how workers are used and where issues occur.

---

## STEP 1: DOM EXTRACTION (BrowserView - Preload Script)
**File:** `app/preload/index.ts`

**Trigger:** Page load events (`load`, `DOMContentLoaded`)

**Process:**
1. `extractAndSendContent()` called when page loads
2. `extractPageContent()` extracts readable text from DOM:
   - Removes scripts, styles, navigation
   - Finds main content area (`article`, `main`, `#content`)
   - Extracts paragraphs, headings, lists
   - Extracts table data as structured text
3. Gets full HTML: `document.documentElement.outerHTML`
4. Sends via IPC to main process:
   ```typescript
   ipcRenderer.invoke('dom:content', {
     tabId: string,
     content: string,      // Extracted text
     htmlContent: string,  // Full HTML
     url: string,
     title: string
   })
   ```

---

## STEP 2: IPC HANDLER (Main Process)
**File:** `app/main/ipc/handlers/dom-handlers.ts`

**Process:**
1. IPC handler receives `'dom:content'` message
2. Validates URL (skips internal URLs)
3. Calls `cachePageContent()` asynchronously (`setImmediate`)
4. Returns immediately (non-blocking)

---

## STEP 3: CACHING & CHUNKING (Main Process)
**File:** `app/main/agent/rag/cache.ts`

**Process:**
1. `cachePageContent(tabId, content, htmlContent, url, title)`
2. Checks for existing cache (deduplication)
3. `extractStructure(htmlContent, content)`:
   - Parses HTML to find sections
   - Extracts headings, paragraphs
   - Creates `Section[]` structure
4. `extractComponents(htmlContent, content)`:
   - Finds forms, tables, buttons
   - Creates `DOMComponent[]` array
5. `chunkContent(content, structure, components)`:
   - Creates `ContentChunk[]` from text
   - Splits large paragraphs (>3000 chars)
   - Creates component-aware chunks
   - Returns array of chunks (e.g., 4288 chunks)
6. Calls `generateChunkEmbeddings(chunks, progressCallback)`

---

## STEP 4: EMBEDDING GENERATION (Main Process)
**File:** `app/main/agent/rag/embeddings.ts`

**Process:**
1. `generateChunkEmbeddings(chunks, progressCallback)`
2. Gets worker pool: `getWorkerPool()`
   - Creates singleton `EmbeddingWorkerPool` if needed
   - Pool size: 16 workers (or CPU cores, max 16)
3. Waits for initialization: `await workerPool.waitForInitialization()`
   - Workers load transformers model sequentially
   - Each worker takes ~2-3 seconds to initialize
4. Sets progress callback: `workerPool.setProgressCallback(...)`
5. For each chunk (4288 chunks):
   ```typescript
   workerPool.generateEmbedding(chunkId, chunk.content)
   ```
   - This queues tasks to workers
   - Returns `Promise<number[]>`

---

## STEP 5: WORKER POOL (Main Process)
**File:** `app/main/agent/rag/worker-pool.ts`

### Architecture
- `EmbeddingWorkerPool` class (singleton)
- 16 `WorkerState` objects (one per worker)
- Each `WorkerState` has:
  - `worker`: Worker thread
  - `taskQueue`: `WorkerTask[]` (queued chunks)
  - `currentTask`: `BatchTask | null`
  - `busy`: boolean
  - `ready`: boolean

### Process Flow

#### 5.1: Task Queuing
1. `generateEmbedding(chunkId, text)` called for each chunk
2. Creates `WorkerTask`: `{ chunkId, text, resolve, reject }`
3. Finds least-busy worker (by `taskQueue.length`)
4. Queues task: `workerState.taskQueue.push(task)`
5. If `queue.length >= batchSize (160)`:
   - Calls `processNextTask(workerIndex)`

#### 5.2: Batch Processing
6. `processNextTask()`:
   - Checks if worker is ready and not busy
   - **Waits for `batchSize (160)` tasks** before processing
   - **Exception:** If all workers are idle and there are remaining tasks, processes them even if < 160
   - Collects `batchSize (160)` tasks from queue
   - Creates `BatchTask`: `{ tasks: WorkerTask[], batchId }`
   - Sets `workerState.busy = true`
   - Sends batch to worker: `worker.postMessage({ type: 'batch', ... })`

#### 5.3: Batch Completion
7. When batch completes:
   - Worker sends back `'batch'` message
   - Resolves all `WorkerTask` promises
   - Updates `totalCompleted += completed`
   - Calls `progressCallback({ current, total })`
   - Sets `workerState.busy = false`
   - Processes next batch if queue has enough tasks

---

## STEP 6: WORKER THREAD (Separate Process)
**File:** `app/main/agent/rag/embedding-worker.ts`

### Process

#### 6.1: Initialization
1. Worker receives `'init'` message:
   - Loads `@xenova/transformers` module
   - Creates `pipeline('feature-extraction', MODEL_NAME)`
   - Warms up model with dummy inference
   - Sends `'ready'` message back

#### 6.2: Batch Processing
2. Worker receives `'batch'` message:
   - Contains: `{ chunks: [{ chunkId, text }] }`
   - Processes all chunks **IN PARALLEL**:
     ```typescript
     Promise.all(chunks.map(chunk => generateEmbedding(chunk.text)))
     ```
   - `generateEmbedding(text)`:
     - Calls `pipeline(text, { pooling: 'mean', normalize: true })`
     - Returns `number[]` (384-dimensional vector)
   - Sends back `'batch'` message:
     ```typescript
     { type: 'batch', batchId, data: { embeddings, errors } }
     ```

---

## CURRENT ISSUE: Progress Stuck at 91%

### Problem
- Progress stuck at **3521/4288 chunks (91%)**
- **Remaining: 767 chunks**
- These chunks are likely queued but not being processed

### Root Cause Analysis

#### Issue 1: Batch Size Requirement
- Workers wait for `batchSize (160)` tasks before processing
- 767 remaining chunks distributed across 16 workers = ~48 chunks per worker
- Each worker has < 160 chunks, so they don't process

#### Issue 2: Remaining Chunks Logic
The code has logic to handle remaining chunks:
```typescript
const allWorkersIdle = this.workers.every(w => !w.busy || w.taskQueue.length === 0);
const shouldProcessRemaining = allWorkersIdle && hasRemainingTasks;
```

**Problem:** This check might not be working correctly:
- Workers might think they're busy when they're not
- `taskQueue.length === 0` check might be wrong
- Logic might not trigger when it should

#### Issue 3: No Progress Updates
- Progress only updates when batches **complete**
- If batches are stuck, no progress updates
- User sees "stuck" at 91%

---

## Proposed Solutions

### Option 1: Fix Remaining Chunks Logic
- Improve `allWorkersIdle` check
- Ensure remaining chunks are processed when all workers finish
- Add logging to debug why remaining chunks aren't processed

### Option 2: Reduce Batch Size for Final Batches
- When total remaining < batchSize, process smaller batches
- Distribute remaining chunks across all workers
- Process immediately without waiting

### Option 3: Redesign Worker Pool
- Remove batch size requirement for final chunks
- Process chunks as soon as they're queued (if worker is idle)
- Use batching only for efficiency, not as a requirement

### Option 4: Add Progress for Queued Chunks
- Show progress based on queued chunks, not just completed
- Update progress when chunks are queued
- Show "X chunks queued, Y chunks processing, Z chunks completed"

---

## Next Steps
1. Debug why remaining chunks aren't being processed
2. Add logging to track worker states
3. Fix the `allWorkersIdle` logic
4. Test with remaining chunks scenario
5. Consider redesigning worker pool if needed

