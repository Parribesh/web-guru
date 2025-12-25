# Complete Event Monitoring Flow: App Start to Job Monitoring

## Overview
This document explains the complete flow from application startup through job submission to real-time event monitoring.

---

## Phase 1: Application Initialization

### 1.1 App Startup
```
1. Electron main process starts (app/main/index.ts)
2. setupIPC() is called → Registers IPC handlers (app/main/ipc/handlers/misc-handlers.ts)
3. EmbeddingService singleton is created (getEmbeddingService())
4. Main process sets up event forwarding from EmbeddingService to renderer
```

**Key Setup:**
- IPC handlers register listeners for EmbeddingService events:
  - `job_started`
  - `job_status_update`
  - `websocket_message`
  - `task_complete`, `task_error`, etc.
- Each listener forwards events to renderer via: `mainWindow.webContents.send('embedding-service:event', eventData)`

### 1.2 Renderer Process Initialization
```
1. React app loads (app/renderer/App.tsx)
2. Components mount (EmbeddingStats, TaskMonitor, WebSocketMonitor)
3. Each component sets up event listeners on 'embedding-service:event' channel
4. Components may load persisted jobId from localStorage
```

**Current State:**
- Components are listening for events
- No active jobs yet
- Components may have stale jobId from previous session

---

## Phase 2: Job Initiation

### 2.1 User Action Triggers Embedding Generation
```
User Action (e.g., create session, process page)
  ↓
Some service calls generateChunkEmbeddings() (app/main/agent/rag/embeddings.ts)
  ↓
generateChunkEmbeddings() calls embeddingService.generateEmbeddings()
```

### 2.2 EmbeddingService.generateEmbeddings() is Called
**Location:** `app/main/agent/rag/embedding-service.ts:738`

**What Happens:**
```typescript
1. Generate unique jobId: const jobId = uuidv4()
2. Emit 'job_started' event: this.emit('job_started', jobId)
3. Split chunks into batches
4. Submit batches to backend via HTTP POST /api/embeddings/batch
```

**Critical Point:** `job_started` event is emitted **immediately** when jobId is created, **before** any batches are submitted.

### 2.3 Event Propagation: job_started

**Path 1: EmbeddingService → Main Process IPC Handler**
```
EmbeddingService.emit('job_started', jobId)
  ↓
misc-handlers.ts:447 service.on('job_started', (jobId) => { ... })
  ↓
Actions:
  1. Forward to renderer: mainWindow.webContents.send('embedding-service:event', { type: 'job_started', jobId })
  2. Connect WebSocket: connectToJobWebSocket(jobId)
```

**Path 2: Main Process → Preload → Renderer**
```
mainWindow.webContents.send('embedding-service:event', eventData)
  ↓
Preload script (app/preload/index.ts:244) receives IPC event
  ↓
Preload forwards to renderer: callback(...args)
  ↓
Renderer components receive event via electronAPI.on('embedding-service:event', handler)
```

**Timeline:**
- T+0ms: `jobId` created
- T+0ms: `job_started` event emitted
- T+1ms: Main process forwards to renderer
- T+2ms: Renderer components receive event
- T+3ms: Components set `currentJobId` state
- T+4ms: Components request WebSocket connection (if they do)

---

## Phase 3: Batch Submission

### 3.1 Batch Submission to Backend
**Location:** `embedding-service.ts:303 submitBatch()`

**What Happens:**
```typescript
1. HTTP POST /api/embeddings/batch with:
   {
     job_id: "uuid-here",
     chunks: [{ chunk_id: "...", text: "..." }]
   }

2. Backend responds with:
   {
     batch_id: "batch-uuid",
     job_id: "uuid-here",  // Echoed back
     tasks: [...]
   }

3. Extract job_id from response
4. Emit 'websocket_message' event: this.emit('websocket_message', { jobId, originalMessage })
```

### 3.2 websocket_message Event Flow
```
EmbeddingService.emit('websocket_message', { jobId, ... })
  ↓
misc-handlers.ts:311 service.on('websocket_message', ...)
  ↓
Forwards to renderer: mainWindow.webContents.send('embedding-service:event', { type: 'websocket_message', jobId, ... })
  ↓
Renderer components receive (can use to detect jobId if job_started was missed)
```

**Note:** This is a backup mechanism in case `job_started` event was missed.

---

## Phase 4: WebSocket Connection

### 4.1 Main Process WebSocket Connection
**Location:** `misc-handlers.ts:347 connectToJobWebSocket()`

**Triggered By:**
1. `job_started` event (automatic)
2. Manual IPC call: `embedding:connect-job-websocket` (from renderer)

**What Happens:**
```typescript
1. Create WebSocket connection: ws://127.0.0.1:8000/ws/job/{jobId}
2. On 'open': Emit 'job_websocket_connected' event to renderer
3. On 'message': 
   - Parse message: { type: "job_status_update", payload: { status: {...} } }
   - Extract payload.status
   - Emit 'job_status_update' event to renderer with extracted status
4. On 'error': Emit 'job_websocket_error' event
5. On 'close': Emit 'job_websocket_closed' event
```

### 4.2 Backend WebSocket Message Format
**Backend sends:**
```json
{
  "type": "job_status_update",
  "payload": {
    "status": {
      "job_id": "uuid",
      "status": "processing",
      "total_chunks": 100,
      "completed_chunks": 50,
      "batches": [...],
      "batch_metrics": {...}
    }
  }
}
```

**Main process extracts:**
```typescript
let jobStatus = parsed.payload.status;  // Extract nested status object
```

**Forwards to renderer:**
```json
{
  "type": "job_status_update",
  "jobId": "uuid",
  "jobStatus": {
    "job_id": "uuid",
    "status": "processing",
    "total_chunks": 100,
    "completed_chunks": 50,
    "batches": [...],
    "batch_metrics": {...}
  },
  "timestamp": 1234567890
}
```

---

## Phase 5: Event Reception in Renderer

### 5.1 Preload Script Event Forwarding
**Location:** `app/preload/index.ts:244`

**What Happens:**
```typescript
ipcRenderer.on(channel, (ipcEvent, ...args) => {
  callback(...args);  // Forward to renderer component's handler
});
```

**Important:** Only the data arguments are forwarded, not the IPC event object itself.

### 5.2 Component Event Handlers

**Current Pattern (PROBLEMATIC):**

**EmbeddingStats / TaskMonitor:**
```typescript
// Listener 1: For job_started (empty deps)
useEffect(() => {
  electronAPI.on('embedding-service:event', (event, eventData) => {
    if (eventData.type === 'job_started') {
      setCurrentJobId(eventData.jobId);
    }
  });
}, []); // Never recreated

// Listener 2: For job_status_update (has deps)
useEffect(() => {
  electronAPI.on('embedding-service:event', (event, eventData) => {
    if (eventData.type === 'job_status_update') {
      if (jobStatusData.job_id === currentJobId) {  // ⚠️ PROBLEM: currentJobId might be null
        setJobStats(jobStatusData);
      }
    }
  });
}, [currentJobId, autoRefresh]); // ⚠️ PROBLEM: Recreated when currentJobId changes
```

**WebSocketMonitor:**
```typescript
// Single listener (good!)
useEffect(() => {
  electronAPI.on('embedding-service:event', (event, eventData) => {
    // Store all events
    setEvents(prev => [newEvent, ...prev]);
  });
}, []); // Never recreated - GOOD!
```

---

## Phase 6: Event Processing Issues

### 6.1 Race Condition Timeline

**Scenario: Event Order Issue**
```
T+0ms:  generateEmbeddings() creates jobId
T+0ms:  Emits 'job_started' event
T+1ms:  Main process forwards 'job_started' to renderer
T+2ms:  Main process connects WebSocket
T+3ms:  Backend sends first 'job_status_update' via WebSocket
T+4ms:  Main process forwards 'job_status_update' to renderer
T+5ms:  Renderer receives 'job_status_update'
        → currentJobId is still null (job_started event not processed yet)
        → Event is IGNORED because of filter condition
T+6ms:  Renderer receives 'job_started' event
        → Sets currentJobId
T+7ms:  React recreates job_status_update listener (because currentJobId changed)
T+8ms:  Next 'job_status_update' arrives
        → Now processed because currentJobId is set
```

**Result:** First job_status_update event is lost!

### 6.2 Multiple Listener Recreation Issue

**When currentJobId changes:**
1. React schedules cleanup of old listener (with old currentJobId closure)
2. React creates new listener (with new currentJobId closure)
3. Between cleanup and creation, events might arrive and be missed
4. Even if events arrive during recreation, the old listener's closure has stale currentJobId

### 6.3 Duplicate WebSocket Connections

**Current Behavior:**
1. Main process automatically connects when `job_started` is received
2. Renderer components also request connection when `currentJobId` is set
3. This can cause duplicate connection attempts or conflicts

---

## Phase 7: Component-Specific Processing

### 7.1 EmbeddingStats
**Purpose:** Monitor batch metrics within jobStatus

**What it does:**
- Receives `job_status_update` events
- Extracts `jobStatus.batch_metrics` and `jobStatus.batches`
- Displays batch-level progress bars and metrics

**Why it works (sometimes):**
- Might receive events after currentJobId is already set (timing/luck)
- Component mount order might favor it

### 7.2 TaskMonitor
**Purpose:** Monitor whole task/job from socket events

**What it does:**
- Receives `job_status_update` events
- Uses full `jobStatus` object
- Displays job-level metrics, batch summaries, etc.

**Why it doesn't work:**
- Same race condition issues as EmbeddingStats
- Events arrive before currentJobId is set
- Filter condition rejects events

### 7.3 WebSocketMonitor
**Purpose:** Monitor ALL events received (debug tool)

**What it does:**
- Receives ALL event types
- Stores them in state
- Displays event list with statistics

**Why it might not work:**
- Should work (single stable listener)
- If not working, might be component mounting/rendering issue
- Or events might not be reaching it

---

## Current Architecture Problems Summary

1. **Race Condition:** Events arrive before currentJobId is set
2. **Listener Recreation:** Dependency arrays cause listener recreation → missed events
3. **Duplicate Connections:** Multiple places try to connect WebSocket
4. **Early Filtering:** Components filter events before they can set currentJobId
5. **Timing Dependency:** Behavior depends on event timing (unreliable)

---

## Proposed Standardized Flow

### Principle: "Accept All, Filter Later"

**Standard Pattern:**
1. **Single Stable Listener** per component (empty dependency array)
2. **Use Refs** to access current state without recreating listener
3. **Auto-detect jobId** from event data (don't require job_started event)
4. **No Early Filtering** - accept all events, filter in display logic
5. **Single WebSocket Connection** - only main process connects

### Ideal Flow:

```
1. generateEmbeddings() → Creates jobId → Emits 'job_started'

2. Main Process:
   - Receives 'job_started' → Connects WebSocket (ONLY ONCE)
   - Forwards 'job_started' to renderer
   - Receives WebSocket messages → Extracts status → Forwards 'job_status_update'

3. Renderer Components (ALL THREE):
   - Single stable listener (never recreated)
   - Receives ALL events
   - Auto-detects jobId from event data
   - Processes events based on component's purpose:
     * EmbeddingStats: Extract batch_metrics
     * TaskMonitor: Use full jobStatus
     * WebSocketMonitor: Store all events
```

### Key Changes:
1. Remove dependency arrays from event listeners (use refs instead)
2. Accept job_status_update events even if currentJobId is not set yet
3. Extract jobId from event data itself (jobStatus.job_id)
4. Remove duplicate WebSocket connection requests from renderer
5. Remove early filtering - process all events

---

## Next Steps

1. Standardize all components to use the same event handling pattern
2. Remove duplicate WebSocket connection logic
3. Fix event filtering to accept events before currentJobId is set
4. Test with console logs to verify event flow
5. Ensure all components receive events reliably

