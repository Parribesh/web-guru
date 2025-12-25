# EventEmitter Explanation and Architecture Proposal

## What is `.emit()` and How Does It Work?

### EventEmitter Pattern (Node.js In-Process Events)

**EventEmitter** is a Node.js built-in class that provides an in-process event system. It's like a pub/sub pattern but within the same process.

```typescript
import { EventEmitter } from 'events';

class MyService extends EventEmitter {
  doSomething() {
    // Emit an event - this notifies all listeners
    this.emit('something_happened', data1, data2);
  }
}

const service = new MyService();

// Listen for events - register a callback
service.on('something_happened', (data1, data2) => {
  console.log('Received:', data1, data2);
});

// Now when doSomething() is called, the listener gets triggered
service.doSomething(); // Listener fires!
```

### Key Points:

1. **Same Process Only**: EventEmitter works within a single Node.js process
2. **Synchronous**: Events are emitted and listeners are called synchronously (in order)
3. **Multiple Listeners**: Multiple listeners can listen to the same event
4. **No IPC**: This is NOT inter-process communication - it's intra-process

---

## Current Architecture (PROBLEMATIC)

### What's Happening Now:

```
Main Process:
├── EmbeddingService (extends EventEmitter)
│   ├── Has its own WebSocket connection to /ws/job/{jobId}
│   ├── Receives messages from backend
│   └── Emits events: this.emit('job_status_update', jobId, jobStatus)
│
└── IPC Handler (misc-handlers.ts)
    ├── Listens: service.on('job_status_update', ...)
    ├── Has ANOTHER WebSocket connection to /ws/job/{jobId}
    ├── Receives messages from backend
    └── Forwards to renderer: mainWindow.webContents.send('embedding-service:event', ...)
```

### Problems:

1. **DUPLICATE WebSocket Connections**: Both EmbeddingService AND IPC handler connect to the same WebSocket!
2. **Redundant Event Flow**: Events flow through EmbeddingService → IPC Handler → Renderer, AND directly from IPC Handler → Renderer
3. **Confusion**: Why does EmbeddingService need to emit events if IPC handler is already listening to the WebSocket?
4. **Job-Specific Logic**: Current logic connects to ONE job at a time, but jobs can be running in parallel

---

## Why This Architecture Exists (Historical Reasons)

Looking at the code, it seems like:

1. **Original Design**: EmbeddingService was meant to handle its own WebSocket for collecting embeddings
2. **Later Addition**: IPC handler was added to provide monitoring to the renderer
3. **Result**: Both systems doing similar things, causing confusion

### Current Flow:

```
1. generateEmbeddings() creates jobId
2. Emits 'job_started' event
3. IPC handler receives 'job_started' → Connects WebSocket
4. EmbeddingService ALSO connects WebSocket (for its own purposes)
5. Both receive the same messages
6. Both emit/forward events
7. Renderer receives duplicate or confusing events
```

---

## Better Architecture (What You Proposed)

### Your Proposed Flow:

```
Main Process WebSocket Manager:
├── Connects to ALL active jobs (not just one)
├── Listens to ALL events from backend
├── Forwards ALL events to renderer (no filtering)
└── Single source of truth

Renderer Components:
├── Receive ALL events
├── Filter based on their needs:
│   ├── EmbeddingStats: Filter by jobId, extract batch_metrics
│   ├── TaskMonitor: Filter by jobId, use full jobStatus
│   └── WebSocketMonitor: Show ALL events (no filtering)
└── Display accordingly
```

### Benefits:

1. **Single WebSocket Connection Per Job**: No duplicates
2. **Single Event Source**: All events come from one place
3. **Clear Separation**: Main process handles WebSocket, renderer handles display
4. **Scalable**: Can handle multiple jobs simultaneously
5. **Simple**: Easier to understand and maintain

---

## Proposed Implementation

### Main Process WebSocket Manager

**Responsibilities:**
- Track all active jobs
- Connect WebSocket for each job when it starts
- Forward ALL events to renderer
- Manage connection lifecycle

**Structure:**
```typescript
// In misc-handlers.ts
const activeJobWebSockets = new Map<string, WebSocket>();

function connectToJobWebSocket(jobId: string) {
  if (activeJobWebSockets.has(jobId)) {
    return; // Already connected
  }
  
  const ws = new WebSocket(`ws://127.0.0.1:8000/ws/job/${jobId}`);
  activeJobWebSockets.set(jobId, ws);
  
  ws.on('message', (data) => {
    const parsed = JSON.parse(data);
    const jobStatus = parsed.payload?.status || parsed.status;
    
    // Forward ALL events to renderer
    mainWindow.webContents.send('embedding-service:event', {
      type: 'job_status_update',
      jobId: jobStatus.job_id || jobId,
      jobStatus,
      timestamp: Date.now(),
    });
  });
  
  ws.on('close', () => {
    activeJobWebSockets.delete(jobId);
  });
}

// Listen for job_started to connect
service.on('job_started', (jobId) => {
  connectToJobWebSocket(jobId);
  // Also forward the job_started event
  mainWindow.webContents.send('embedding-service:event', {
    type: 'job_started',
    jobId,
    timestamp: Date.now(),
  });
});
```

### EmbeddingService Changes

**Remove:**
- Its own WebSocket connection (lines 832-950 in embedding-service.ts)
- The job_status_update emission (line 876)
- Keep only what's needed for collecting embeddings (can use HTTP polling or separate connection if needed)

**Keep:**
- `job_started` emission (so main process knows to connect)
- Batch submission logic
- HTTP polling for task status (if still needed)

### Renderer Components

**All components follow same pattern:**
```typescript
// Single stable listener
useEffect(() => {
  const electronAPI = (window as any).electronAPI;
  if (!electronAPI?.on) return;

  const handleEvent = (_event: any, eventData: any) => {
    // Receive ALL events
    // Filter/process based on component needs
    if (eventData.type === 'job_status_update') {
      const jobStatus = eventData.jobStatus;
      const jobId = jobStatus.job_id || eventData.jobId;
      
      // Component-specific processing
      if (componentNeedsThisJob(jobId)) {
        processJobStatus(jobStatus);
      }
    }
  };

  electronAPI.on('embedding-service:event', handleEvent);
  return () => {
    electronAPI.off('embedding-service:event', handleEvent);
  };
}, []); // Stable listener
```

---

## Event Flow Comparison

### Current (Bad):
```
Backend → EmbeddingService WebSocket → EmbeddingService.emit() → IPC Handler → Renderer
Backend → IPC Handler WebSocket → IPC Handler → Renderer
```
**Two paths, duplicate connections, confusing**

### Proposed (Good):
```
Backend → Main Process WebSocket Manager → Renderer (all events)
```
**Single path, clear, simple**

---

## Key Insight

**You're absolutely right**: EmbeddingService emitting events to IPC handler is confusing because they're in the same process. The EventEmitter pattern is for in-process communication, but what we really need is:

1. **Main Process**: Manage WebSocket connections, forward events to renderer
2. **Renderer**: Receive events, filter and display

The EmbeddingService shouldn't need to emit events for monitoring - that's the job of the WebSocket manager!

