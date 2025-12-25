# Embedding Service API Contract

This document describes the HTTP and WebSocket API that the Python embedding service must implement.

## Base Configuration

- **Default Base URL**: `http://localhost:8000`
- **Default WebSocket URL**: `ws://localhost:8000/ws`
- **Configurable via environment variables**:
  - `EMBEDDING_SERVICE_URL` - HTTP base URL
  - `EMBEDDING_SERVICE_SOCKET_URL` - WebSocket URL
  - `EMBEDDING_SERVICE_API_KEY` - Optional API key for authentication

## HTTP Endpoints

### 1. Health Check

**Endpoint**: `GET /health`

**Description**: Check if the service is available and ready to process requests.

**Request**:
- Method: `GET`
- Headers: None required
- Body: None

**Response**:
- Status Code: `200` (service is available)
- Body: Any (content ignored, only status code matters)

**Example**:
```bash
curl http://localhost:8000/health
```

---

### 2. Submit Single Embedding Task

**Endpoint**: `POST /api/embeddings/task`

**Description**: Submit a single text chunk for embedding generation. Returns a task ID immediately (non-blocking).

**Request**:
- Method: `POST`
- Headers:
  - `Content-Type: application/json`
  - `Authorization: Bearer <api_key>` (optional, if API key is configured)
- Body (JSON):
```json
{
  "chunk_id": "string",  // Unique identifier for this chunk
  "text": "string"       // Text content to generate embedding for
}
```

**Response**:
- Status Code: `200` or `201` (success)
- Body (JSON):
```json
{
  "task_id": "string"    // Unique task identifier for tracking progress
}
```

**Error Responses**:
- `400` - Bad Request (invalid JSON or missing fields)
- `401` - Unauthorized (if API key is required and invalid)
- `500` - Internal Server Error

**Example**:
```bash
curl -X POST http://localhost:8000/api/embeddings/task \
  -H "Content-Type: application/json" \
  -d '{
    "chunk_id": "chunk-123",
    "text": "This is the text to embed"
  }'
```

**Response Example**:
```json
{
  "task_id": "task-abc-123-def-456"
}
```

---

### 3. Get Task Status (Polling Fallback)

**Endpoint**: `GET /api/embeddings/task/{task_id}`

**Description**: Get the current status of an embedding task. Used as fallback when WebSocket is unavailable.

**Request**:
- Method: `GET`
- Headers:
  - `Authorization: Bearer <api_key>` (optional, if API key is configured)
- Path Parameters:
  - `task_id` - The task ID returned from task submission

**Response**:
- Status Code: `200` (success)
- Body (JSON):
```json
{
  "task_id": "string",
  "status": "pending" | "processing" | "completed" | "failed",
  "progress": 0.0-1.0,  // Optional: progress percentage (0.0 to 1.0)
  "result": {           // Present when status is "completed"
    "chunk_id": "string",
    "embedding": [0.123, -0.456, ...]  // Array of numbers (vector)
  },
  "error": "string"     // Present when status is "failed"
}
```

**Status Values**:
- `pending` - Task is queued, not yet started
- `processing` - Task is currently being processed
- `completed` - Task completed successfully, `result` field contains embedding
- `failed` - Task failed, `error` field contains error message

**Example**:
```bash
curl http://localhost:8000/api/embeddings/task/task-abc-123-def-456
```

**Response Examples**:

Pending:
```json
{
  "task_id": "task-abc-123-def-456",
  "status": "pending"
}
```

Processing:
```json
{
  "task_id": "task-abc-123-def-456",
  "status": "processing",
  "progress": 0.5
}
```

Completed:
```json
{
  "task_id": "task-abc-123-def-456",
  "status": "completed",
  "result": {
    "chunk_id": "chunk-123",
    "embedding": [0.123, -0.456, 0.789, ...]
  }
}
```

Failed:
```json
{
  "task_id": "task-abc-123-def-456",
  "status": "failed",
  "error": "Model initialization failed"
}
```

---

## WebSocket Endpoint

### Connection

**URL**: `ws://localhost:8000/ws` (or configured `EMBEDDING_SERVICE_SOCKET_URL`)

**Description**: Real-time progress monitoring for embedding tasks. The client connects once and receives updates for all tasks.

**Connection**: 
- Protocol: WebSocket
- No authentication required (unless you want to add it)
- Client connects after submitting tasks

**Message Format**: All messages are JSON strings.

---

### WebSocket Messages (Server → Client)

The server sends progress updates for tasks. Each message has a `type` field:

#### 1. Task Progress Update

Sent when a task is processing and progress is available.

```json
{
  "type": "task_progress",
  "status": {
    "task_id": "string",
    "status": "processing",
    "progress": 0.5  // 0.0 to 1.0
  }
}
```

#### 2. Task Complete

Sent when a task completes successfully.

```json
{
  "type": "task_complete",
  "status": {
    "task_id": "string",
    "status": "completed",
    "result": {
      "chunk_id": "string",
      "embedding": [0.123, -0.456, ...]
    }
  }
}
```

#### 3. Task Error

Sent when a task fails.

```json
{
  "type": "task_error",
  "status": {
    "task_id": "string",
    "status": "failed",
    "error": "Error message describing what went wrong"
  }
}
```

---

## TypeScript Type Definitions

For reference, here are the TypeScript types used in the client:

```typescript
// Request type for submitting a task
interface EmbeddingTaskRequest {
  chunk_id: string;
  text: string;
}

// Response type for task submission
interface TaskSubmissionResponse {
  task_id: string;
}

// Task status (used in polling and WebSocket)
interface TaskStatus {
  task_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;  // 0.0 to 1.0
  result?: {
    chunk_id: string;
    embedding: number[];  // Vector of numbers
  };
  error?: string;
}

// WebSocket message types
interface WebSocketMessage {
  type: 'task_progress' | 'task_complete' | 'task_error';
  status: TaskStatus;
}
```

---

## How Chunks Are Processed

### Current Implementation (One-by-One)

The current implementation submits chunks **one at a time**:

1. For each chunk, client calls `POST /api/embeddings/task` with `chunk_id` and `text`
2. Server returns `task_id` immediately (non-blocking)
3. Client tracks task via WebSocket or polling
4. When task completes, client receives embedding vector
5. Process repeats for all chunks in parallel

**Example Flow**:
```
Chunk 1 → POST /api/embeddings/task → task_id_1
Chunk 2 → POST /api/embeddings/task → task_id_2
Chunk 3 → POST /api/embeddings/task → task_id_3
...
WebSocket receives updates for all tasks as they complete
```

### Batch Submission

**Endpoint**: `POST /api/embeddings/batch`

**Request**:
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",  // Optional: UUID for grouping batches
  "chunks": [
    { "chunk_id": "chunk-1", "text": "text 1" },
    { "chunk_id": "chunk-2", "text": "text 2" },
    { "chunk_id": "chunk-3", "text": "text 3" }
  ]
}
```

**Response**:
```json
{
  "batch_id": "batch-abc-123",
  "job_id": "550e8400-e29b-41d4-a716-446655440000",  // Echoed back if provided
  "tasks": [
    { 
      "chunk_id": "chunk-1", 
      "task_id": "task-1",
      "batch_id": "batch-abc-123"  // Each task includes its batch_id
    },
    { 
      "chunk_id": "chunk-2", 
      "task_id": "task-2",
      "batch_id": "batch-abc-123"
    },
    { 
      "chunk_id": "chunk-3", 
      "task_id": "task-3",
      "batch_id": "batch-abc-123"
    }
  ]
}
```

**Notes**:
- Each task in the response should include `batch_id` so chunks can be tracked to their batch
- WebSocket messages should also include `batch_id` in task status updates

**Notes**:
- All batches with the same `job_id` belong to the same embedding job
- The server should track batches and tasks per job
- WebSocket messages can include `batch_id` and `job_id` for progress tracking

### Job Statistics

**Endpoint**: `GET /api/embeddings/job/{job_id}`

**Response**:
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",  // "pending" | "processing" | "completed" | "failed"
  "total_chunks": 64,
  "total_batches": 2,
  "completed_chunks": 64,
  "failed_chunks": 0,
  "start_time": 1234567890000,  // Unix timestamp in milliseconds
  "end_time": 1234567895000,   // Unix timestamp in milliseconds (optional)
  "duration": 5000,             // Duration in milliseconds (optional)
  "success_rate": 100.0,        // Percentage (optional)
  "batches": [
    {
      "batch_id": "batch-abc-123",
      "batch_index": 0,          // 0-based index within the job
      "chunks_count": 32,
      "tasks_count": 32,
      "completed_count": 32,
      "failed_count": 0,
      "start_time": 1234567890000,
      "end_time": 1234567892500,
      "duration": 2500,
      "status": "completed"     // "pending" | "processing" | "completed" | "failed"
    },
    {
      "batch_id": "batch-def-456",
      "batch_index": 1,
      "chunks_count": 32,
      "tasks_count": 32,
      "completed_count": 32,
      "failed_count": 0,
      "start_time": 1234567892500,
      "end_time": 1234567895000,
      "duration": 2500,
      "status": "completed"
    }
  ]
}
```

**Notes**:
- Returns comprehensive statistics for a job including all batches
- Each batch includes individual metrics (tasks, duration, status)
- Useful for displaying detailed progress and performance metrics

---

## Expected Embedding Format

- **Model**: The Python service can use any embedding model (e.g., sentence-transformers, OpenAI, etc.)
- **Vector Format**: Array of floating-point numbers
- **Normalization**: Embeddings should be normalized (L2 norm = 1.0) for cosine similarity
- **Dimensions**: Consistent dimension size for all embeddings (e.g., 384 for all-MiniLM-L6-v2)

**Example Embedding**:
```json
{
  "chunk_id": "chunk-123",
  "embedding": [0.123, -0.456, 0.789, 0.012, ...]  // 384 numbers
}
```

---

## Error Handling

### Client-Side Timeout
- Default timeout: 30 seconds per task
- If task doesn't complete within timeout, client rejects the promise
- Server should handle long-running tasks gracefully

### Server-Side Errors
- Return appropriate HTTP status codes
- Include error messages in response body
- For WebSocket, send `task_error` message type

### Retry Logic
- Client does NOT automatically retry failed tasks
- Application layer can implement retry if needed
- Server should handle duplicate task submissions gracefully (idempotency)

---

## Performance Considerations

1. **Concurrent Requests**: Client submits all chunks in parallel, so server should handle concurrent requests
2. **Queue Management**: Server should queue tasks if processing capacity is limited
3. **Progress Updates**: Send progress updates via WebSocket for better UX
4. **Batch Processing**: Consider processing multiple chunks in a single batch for efficiency

---

## Example Python Server Implementation Structure

```python
# Pseudo-code structure

from fastapi import FastAPI, WebSocket
from pydantic import BaseModel
import asyncio
from typing import List, Dict

app = FastAPI()

# Task storage (use Redis or database in production)
tasks: Dict[str, TaskStatus] = {}

class EmbeddingTaskRequest(BaseModel):
    chunk_id: str
    text: str

class TaskSubmissionResponse(BaseModel):
    task_id: str

class TaskStatus(BaseModel):
    task_id: str
    status: str  # "pending", "processing", "completed", "failed"
    progress: float = None
    result: Dict = None
    error: str = None

@app.get("/health")
async def health_check():
    return {"status": "ok"}

@app.post("/api/embeddings/task")
async def submit_task(request: EmbeddingTaskRequest):
    task_id = generate_task_id()
    # Queue task for processing
    tasks[task_id] = TaskStatus(
        task_id=task_id,
        status="pending",
        chunk_id=request.chunk_id
    )
    # Start processing in background
    asyncio.create_task(process_embedding(task_id, request.chunk_id, request.text))
    return TaskSubmissionResponse(task_id=task_id)

@app.get("/api/embeddings/task/{task_id}")
async def get_task_status(task_id: str):
    return tasks.get(task_id, {"error": "Task not found"})

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    # Send task updates as they complete
    # Implementation depends on your architecture
```

---

## Summary

The Python server needs to implement:

1. ✅ `GET /health` - Health check endpoint
2. ✅ `POST /api/embeddings/task` - Submit single embedding task
3. ✅ `GET /api/embeddings/task/{task_id}` - Get task status (for polling)
4. ✅ `WS /ws` - WebSocket endpoint for real-time progress updates

**Key Points**:
- Tasks are submitted one at a time (can be enhanced with batch endpoint)
- Server returns task IDs immediately (non-blocking)
- Progress is monitored via WebSocket (with polling fallback)
- Embeddings are returned as arrays of floating-point numbers
- Server should handle concurrent requests efficiently

