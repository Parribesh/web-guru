# Monitoring Components Analysis Report

## Current Architecture Overview

### Event Flow
1. **Backend** → WebSocket `/ws/job/{jobId}` → Sends `{ type: "job_status_update", payload: { status: {...} } }`
2. **Main Process (IPC Handler)** → Receives WebSocket message → Extracts `payload.status` → Forwards via IPC `embedding-service:event`
3. **Preload Script** → Receives IPC event → Forwards to renderer via `electronAPI.on()`
4. **Renderer Components** → Listen to `embedding-service:event` → Update state

### Components and Their Roles

1. **EmbeddingStats** ✅ (Working)
   - Purpose: Monitor batch metrics within jobStatus
   - Uses: `jobStatus.batch_metrics` and `jobStatus.batches`
   
2. **TaskMonitor** ❌ (Not Working)
   - Purpose: Monitor whole task/job from socket events
   - Uses: Full `jobStatus` object
   
3. **WebSocketMonitor** ❌ (Not Working)
   - Purpose: Monitor ALL events received
   - Uses: Raw event data (all types)

---

## Identified Issues

### Issue 1: Multiple Event Listeners with Different Dependency Arrays

**Problem:**
- Both EmbeddingStats and TaskMonitor have TWO separate event listeners on the same channel
- Listener 1: For `job_started`/`websocket_message` (empty deps `[]`)
- Listener 2: For `job_status_update` (with `[currentJobId, autoRefresh]` deps)

**Impact:**
- When `currentJobId` changes, React recreates the second listener
- During cleanup/creation window, events can be missed
- Creates timing-dependent behavior

**Why EmbeddingStats Works:**
- Might work due to timing/luck, or component mounting order
- Not a reliable pattern

**Evidence:**
```typescript
// EmbeddingStats has this pattern:
useEffect(() => { /* job_started listener */ }, []); // Never recreated
useEffect(() => { /* job_status_update listener */ }, [currentJobId, autoRefresh]); // Recreated when currentJobId changes
```

---

### Issue 2: Event Filtering Before currentJobId is Set

**Problem:**
- TaskMonitor filters events: `if (jobStatusData.job_id === currentJobId || eventData.jobId === currentJobId)`
- If `currentJobId` is `null`, this check fails and events are ignored
- Events might arrive before `job_started` event sets the `currentJobId`

**Impact:**
- Early `job_status_update` events are dropped
- Component shows "waiting for job to start" even when events are arriving

**Evidence:**
```typescript
// TaskMonitor line 118:
if (jobStatusData.job_id === currentJobId || eventData.jobId === currentJobId) {
  // Only processes if currentJobId is set
}
// But currentJobId might be null when first events arrive!
```

---

### Issue 3: Race Condition in Job ID Detection

**Problem:**
- Components depend on `job_started` event to set `currentJobId`
- But `job_status_update` events might arrive first
- Order of events is not guaranteed

**Timeline Example:**
1. `job_status_update` event arrives → currentJobId is null → Event ignored
2. `job_started` event arrives → currentJobId is set
3. Next `job_status_update` event arrives → Now processed

**Impact:**
- First few job status updates are lost
- Component appears "stuck" until next update cycle

---

### Issue 4: Duplicate Event Sources

**Problem:**
- **Two sources** of `job_status_update` events:
  1. Main process WebSocket manager (misc-handlers.ts) - from centralized connection
  2. EmbeddingService class (embedding-service.ts) - from its own WebSocket connection

**Evidence:**
```typescript
// misc-handlers.ts line 411:
mainWindow.webContents.send('embedding-service:event', eventData); // From main process WebSocket

// embedding-service.ts line 876:
this.emit('job_status_update', jobId, jobStatus); // From EmbeddingService
// Then forwarded in misc-handlers.ts line 331:
mainWindow.webContents.send('embedding-service:event', eventData); // Forwarded to renderer
```

**Impact:**
- Duplicate events might cause state updates twice
- Or one source might work while other doesn't
- Inconsistent behavior

---

### Issue 5: WebSocket Connection Race Condition

**Problem:**
- **Two places** request WebSocket connection:
  1. Main process automatically connects when `job_started` event is received
  2. Renderer components request connection when `currentJobId` is detected

**Timeline:**
1. `job_started` event → Main process connects WebSocket
2. `job_started` event → Renderer receives it → Sets currentJobId → Requests connection again
3. Main process might already be connected, causing duplicate connection attempts

**Impact:**
- Unnecessary duplicate connection attempts
- Potential connection conflicts

---

### Issue 6: Component Initialization Order Dependency

**Problem:**
- Components load `currentJobId` from localStorage on mount
- Then set up event listeners
- If job is already running, events might arrive before listeners are ready

**Evidence:**
```typescript
// TaskMonitor line 62-67:
useEffect(() => {
  const storedJobId = localStorage.getItem('task-monitor:lastJobId');
  if (storedJobId) {
    setCurrentJobId(storedJobId);
  }
}, []); // Runs once on mount
```

**Impact:**
- Events missed during initialization
- Stale jobId from localStorage might not match current job

---

### Issue 7: WebSocketMonitor Might Not Be Receiving Events

**Potential Issues:**
1. Component might not be mounted when events are sent
2. Event listener might not be registered in time
3. Events might be filtered/dropped somewhere in the chain

**Evidence:**
- WebSocketMonitor code looks correct
- Has empty dependency array (stable listener)
- Should receive all events
- But user reports it's not showing events

---

## Root Cause Analysis

### Why EmbeddingStats Works But TaskMonitor Doesn't

**Possible Reasons:**

1. **Timing/Luck**: EmbeddingStats might be receiving events at the right time when currentJobId is already set

2. **Component Mount Order**: If EmbeddingStats mounts before TaskMonitor, it might capture the job_started event first

3. **localStorage Key Difference**: 
   - EmbeddingStats: `embedding-stats:lastJobId`
   - TaskMonitor: `task-monitor:lastJobId`
   - Different keys might have different values

4. **State Update Timing**: React's batching might cause different behavior between components

---

## Standardization Requirements

Based on your requirements:

1. **TaskMonitor**: Should monitor whole task/job from socket events
   - Use full `jobStatus` object
   - Display all job-level metrics
   - Should work identically to how it receives events

2. **WebSocketMonitor**: Should monitor ALL events received
   - Show every event that comes through IPC
   - No filtering
   - Debug/development tool

3. **EmbeddingStats**: Should monitor batch metrics within jobStatus
   - Use `jobStatus.batch_metrics` and `jobStatus.batches`
   - Display batch-level progress
   - Should work with the same jobStatus object

---

## Recommended Standardization Pattern

### Core Principles:

1. **Single Event Listener Per Component** (avoid multiple listeners)
2. **Stable Listener** (use refs to access current state without recreating listener)
3. **Accept Events Even Without currentJobId** (auto-detect from event data)
4. **Single Source of Truth** (only main process WebSocket manager should connect and forward)
5. **No Filtering by Job ID** (let all components see all events, filter in display logic if needed)

### Standard Pattern:

```typescript
// 1. Load persisted jobId (optional)
useEffect(() => {
  const storedJobId = localStorage.getItem('component:lastJobId');
  if (storedJobId) setCurrentJobId(storedJobId);
}, []);

// 2. Single unified event listener (stable, never recreated)
const currentJobIdRef = useRef<string | null>(null);
useEffect(() => { currentJobIdRef.current = currentJobId; }, [currentJobId]);

useEffect(() => {
  const electronAPI = (window as any).electronAPI;
  if (!electronAPI?.on) return;

  const handleEvent = (_event: any, eventData: any) => {
    // Auto-detect jobId from events
    if (eventData.type === 'job_started' && eventData.jobId) {
      setCurrentJobId(eventData.jobId);
    }
    
    // Process job_status_update (accept even if currentJobId not set yet)
    if (eventData.type === 'job_status_update' && eventData.jobStatus) {
      const jobStatus = eventData.jobStatus;
      const eventJobId = jobStatus.job_id || eventData.jobId;
      
      // Update currentJobId if not set
      if (!currentJobIdRef.current && eventJobId) {
        setCurrentJobId(eventJobId);
      }
      
      // Process the event (all components receive same data)
      // Component-specific filtering/processing happens here
      processJobStatus(jobStatus);
    }
    
    // Handle other event types...
  };

  electronAPI.on('embedding-service:event', handleEvent);
  return () => {
    if (electronAPI?.off) {
      electronAPI.off('embedding-service:event', handleEvent);
    }
  };
}, []); // Empty deps - never recreated
```

---

## Next Steps for Fix

1. **Remove duplicate WebSocket connections** - Only main process should connect
2. **Standardize event listeners** - Single stable listener per component using refs
3. **Remove job ID filtering** - Let all events through, filter in display logic
4. **Fix timing issues** - Accept events even when currentJobId is not set yet
5. **Test WebSocketMonitor** - Verify events are actually being received
6. **Consolidate event sources** - Remove duplicate job_status_update from EmbeddingService

