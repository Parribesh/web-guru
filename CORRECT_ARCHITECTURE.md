# Correct Architecture for Event Monitoring

## Understanding EventEmitter (Current Confusion)

### What is `.emit()`?

```typescript
// EmbeddingService extends EventEmitter
class EmbeddingService extends EventEmitter {
  doSomething() {
    this.emit('job_started', jobId);  // Notify all listeners
  }
}

// IPC Handler listens in the same process
service.on('job_started', (jobId) => {
  // This runs in the SAME process
  // EventEmitter is just an in-process pub/sub system
});
```

**Key Point**: `.emit()` is for **in-process communication** within the main process. It's not IPC!

### Why This Is Confusing

You're right - EmbeddingService and IPC handler are **both in the main process**, so why use `.emit()`? 

**Current Flow (REDUNDANT):**
```
EmbeddingService:
  1. Creates WebSocket connection
  2. Receives messages
  3. Emits event: this.emit('job_status_update', ...)

IPC Handler:
  1. ALSO creates WebSocket connection (duplicate!)
  2. ALSO receives messages
  3. Listens to EmbeddingService events
  4. Forwards to renderer

Result: Two WebSocket connections to the same job!
```

---

## Current Problem: JobId-Based Connection Logic

### The Bad Logic:

```typescript
// misc-handlers.ts
let jobWebSocket: any = null;
let currentJobId: string | null = null;

const connectToJobWebSocket = (jobId: string) => {
  if (currentJobId !== jobId) {
    // Close existing connection if switching jobs
    jobWebSocket.close();
  }
  // Connect to new job
};
```

**Problems:**
1. ❌ Only connects to ONE job at a time
2. ❌ Closes connection when switching jobs
3. ❌ Can't monitor multiple jobs simultaneously
4. ❌ Job-specific connection management is complex

---

## Your Proposed Architecture (CORRECT)

### Principle: "Main Process Monitors All, Renderer Filters"

```
Main Process WebSocket Manager:
  ├── Track ALL active jobs: Map<jobId, WebSocket>
  ├── Connect WebSocket for each job when it starts
  ├── Listen to ALL events from backend
  ├── Forward ALL events to renderer (no filtering)
  └── Single source of truth

Renderer Components:
  ├── Receive ALL events from main process
  ├── Filter/process based on component needs:
  │   ├── EmbeddingStats: Extract batch_metrics from jobStatus
  │   ├── TaskMonitor: Use full jobStatus object
  │   └── WebSocketMonitor: Show all events
  └── Display accordingly
```

---

## Proposed Implementation

### 1. Main Process WebSocket Manager

**Location**: `app/main/ipc/handlers/misc-handlers.ts`

```typescript
// Track all active job WebSocket connections
const activeJobWebSockets = new Map<string, WebSocket>();

function connectToJobWebSocket(jobId: string) {
  // Don't connect if already connected
  if (activeJobWebSockets.has(jobId)) {
    console.log(`[IPC] Already connected to WebSocket for job ${jobId}`);
    return;
  }

  const service = getEmbeddingService();
  const baseUrl = service.baseUrl || 'http://127.0.0.1:8000';
  const wsUrl = baseUrl.replace(/^http/, 'ws') + `/ws/job/${jobId}`;
  
  console.log(`[IPC] Connecting to job WebSocket: ${wsUrl}`);
  
  const ws = new WebSocket(wsUrl);
  activeJobWebSockets.set(jobId, ws);

  ws.on('open', () => {
    console.log(`[IPC] Connected to job WebSocket for job ${jobId}`);
    mainWindow.webContents.send('embedding-service:event', {
      type: 'job_websocket_connected',
      jobId,
      timestamp: Date.now(),
    });
  });

  ws.on('message', (data: Buffer | string) => {
    try {
      const message = typeof data === 'string' ? data : data.toString();
      const parsed = JSON.parse(message);
      
      // Extract jobStatus from payload.status
      let jobStatus = parsed;
      if (parsed.type === 'job_status_update' && parsed.payload?.status) {
        jobStatus = parsed.payload.status;
      } else if (parsed.status && typeof parsed.status === 'object') {
        jobStatus = parsed.status;
      }
      
      // Forward ALL events to renderer (no filtering)
      mainWindow.webContents.send('embedding-service:event', {
        type: 'job_status_update',
        jobId: jobStatus.job_id || jobId,
        jobStatus,
        timestamp: Date.now(),
      });
    } catch (error: any) {
      console.error(`[IPC] Error parsing WebSocket message: ${error.message}`);
    }
  });

  ws.on('error', (error: Error) => {
    console.error(`[IPC] WebSocket error for job ${jobId}:`, error.message);
    mainWindow.webContents.send('embedding-service:event', {
      type: 'job_websocket_error',
      jobId,
      error: error.message,
      timestamp: Date.now(),
    });
  });

  ws.on('close', () => {
    console.log(`[IPC] WebSocket closed for job ${jobId}`);
    activeJobWebSockets.delete(jobId);
    mainWindow.webContents.send('embedding-service:event', {
      type: 'job_websocket_closed',
      jobId,
      timestamp: Date.now(),
    });
  });
}

// Listen for job_started to connect WebSocket
service.on('job_started', (jobId: string) => {
  console.log(`[IPC] Job started, connecting WebSocket for job ${jobId}`);
  
  // Forward job_started event to renderer
  mainWindow.webContents.send('embedding-service:event', {
    type: 'job_started',
    jobId,
    timestamp: Date.now(),
  });
  
  // Connect WebSocket
  connectToJobWebSocket(jobId);
});
```

**Key Changes:**
- ✅ Use `Map<jobId, WebSocket>` to track multiple connections
- ✅ Don't close existing connections when new jobs start
- ✅ Forward ALL events to renderer (no filtering)
- ✅ Remove duplicate connection logic

### 2. Remove EmbeddingService WebSocket Connection

**Location**: `app/main/agent/rag/embedding-service.ts`

**Remove:**
- Lines 832-950: The WebSocket connection in `generateEmbeddings()`
- Line 876: The `this.emit('job_status_update', ...)` call

**Keep:**
- Line 747: `this.emit('job_started', jobId)` - So main process knows to connect
- Batch submission logic
- HTTP polling for task completion (if still needed for collecting embeddings)

**Why:**
- EmbeddingService's WebSocket was only used to emit events for monitoring
- Main process WebSocket manager now handles all monitoring
- EmbeddingService can use HTTP polling or a separate connection for collecting embeddings if needed

### 3. Renderer Components - Standard Pattern

All components use the same pattern:

```typescript
// Single stable event listener
useEffect(() => {
  const electronAPI = (window as any).electronAPI;
  if (!electronAPI?.on) return;

  const handleEvent = (_event: any, eventData: any) => {
    // Receive ALL events
    
    // Component-specific processing
    if (eventData.type === 'job_status_update') {
      const jobStatus = eventData.jobStatus;
      const jobId = jobStatus.job_id || eventData.jobId;
      
      // Filter based on component needs
      // (or don't filter - show all jobs)
      processJobStatus(jobStatus);
    }
    
    // Handle other event types...
  };

  electronAPI.on('embedding-service:event', handleEvent);
  
  return () => {
    electronAPI.off('embedding-service:event', handleEvent);
  };
}, []); // Stable - never recreated
```

**Component-Specific Processing:**

1. **EmbeddingStats**: Extract `jobStatus.batch_metrics` for batch progress
2. **TaskMonitor**: Use full `jobStatus` object for job-level metrics
3. **WebSocketMonitor**: Store all events, no filtering

---

## Benefits of This Architecture

1. ✅ **Single WebSocket Per Job**: No duplicates
2. ✅ **Multiple Jobs**: Can monitor multiple jobs simultaneously
3. ✅ **Clear Separation**: Main process = WebSocket management, Renderer = Display logic
4. ✅ **No EventEmitter Confusion**: Main process directly forwards WebSocket messages
5. ✅ **Simple**: Easier to understand and maintain
6. ✅ **Scalable**: Easy to add more monitoring components

---

## Event Flow (Proposed)

```
1. generateEmbeddings() → Creates jobId → Emits 'job_started'

2. Main Process IPC Handler:
   ├── Receives 'job_started' event
   ├── Connects WebSocket: ws://127.0.0.1:8000/ws/job/{jobId}
   ├── Stores connection in Map<jobId, WebSocket>
   └── Forwards 'job_started' to renderer

3. Backend sends job_status_update messages:
   ├── Main process receives via WebSocket
   ├── Extracts payload.status
   └── Forwards to renderer (all events, no filtering)

4. Renderer Components:
   ├── Receive ALL events
   ├── Filter/process based on component needs
   └── Update UI
```

---

## Summary

**Your insight is correct:**
- EmbeddingService emitting events to IPC handler is confusing (same process)
- JobId-based connection logic is bad (only one job at a time)
- Main process should monitor ALL jobs and forward ALL events
- Renderer should filter based on component needs

**This is the right architecture!**

