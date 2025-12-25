# Embedding Service API - Quick Reference

## Endpoints Summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/health` | Health check |
| `POST` | `/api/embeddings/task` | Submit single embedding task |
| `GET` | `/api/embeddings/task/{task_id}` | Get task status (polling) |
| `WS` | `/ws` | WebSocket for progress updates |

---

## Request/Response Types

### 1. Submit Task

**Request**: `POST /api/embeddings/task`
```json
{
  "chunk_id": "string",
  "text": "string"
}
```

**Response**: `200/201`
```json
{
  "task_id": "string"
}
```

---

### 2. Get Task Status

**Request**: `GET /api/embeddings/task/{task_id}`

**Response**: `200`
```json
{
  "task_id": "string",
  "status": "pending" | "processing" | "completed" | "failed",
  "progress": 0.0-1.0,  // optional
  "result": {           // when completed
    "chunk_id": "string",
    "embedding": [0.123, -0.456, ...]  // array of numbers
  },
  "error": "string"     // when failed
}
```

---

### 3. WebSocket Messages

**Server → Client**:

Progress:
```json
{
  "type": "task_progress",
  "status": {
    "task_id": "string",
    "status": "processing",
    "progress": 0.5
  }
}
```

Complete:
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

Error:
```json
{
  "type": "task_error",
  "status": {
    "task_id": "string",
    "status": "failed",
    "error": "Error message"
  }
}
```

---

## How Chunks Are Processed

**Current Flow** (One-by-One):
1. Client submits each chunk individually via `POST /api/embeddings/task`
2. Server returns `task_id` immediately (non-blocking)
3. Client tracks progress via WebSocket or polling
4. When complete, client receives embedding vector

**Example**:
```
Chunk 1 → POST → task_id_1 → WebSocket update → embedding_1
Chunk 2 → POST → task_id_2 → WebSocket update → embedding_2
Chunk 3 → POST → task_id_3 → WebSocket update → embedding_3
...
All processed in parallel
```

---

## Python Server Requirements

1. **Health Check**: `GET /health` returns `200`
2. **Task Submission**: `POST /api/embeddings/task` accepts chunk, returns task_id
3. **Status Polling**: `GET /api/embeddings/task/{task_id}` returns task status
4. **WebSocket**: `WS /ws` sends progress updates as JSON messages

**Key Points**:
- Tasks are non-blocking (return task_id immediately)
- Progress updates via WebSocket (polling as fallback)
- Embeddings are arrays of floating-point numbers
- Handle concurrent requests efficiently

