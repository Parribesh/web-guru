# Fast Open-Source LLM Models for Ollama

## Current Configuration
- **Default Model**: `llama3.2:1b` (1 billion parameters - fastest)
- **Previous**: `llama3.2:latest` (3B or 7B - slower)

## Recommended Fast Models (Ordered by Speed)

### 1. **llama3.2:1b** ⚡ (Fastest - Recommended)
- **Size**: 1B parameters
- **Speed**: Very fast (~100-500ms responses)
- **Quality**: Good for simple Q&A, data extraction
- **Install**: `ollama pull llama3.2:1b`
- **Best for**: Quick responses, simple queries, data extraction

### 2. **phi3:mini** ⚡⚡
- **Size**: 3.8B parameters (but optimized)
- **Speed**: Fast (~200-800ms)
- **Quality**: Excellent for reasoning tasks
- **Install**: `ollama pull phi3:mini`
- **Best for**: Balanced speed and quality

### 3. **gemma2:2b** ⚡⚡
- **Size**: 2B parameters
- **Speed**: Fast (~150-600ms)
- **Quality**: Good general purpose
- **Install**: `ollama pull gemma2:2b`
- **Best for**: General purpose, multilingual

### 4. **qwen2:1.5b** ⚡⚡⚡
- **Size**: 1.5B parameters
- **Speed**: Very fast (~100-500ms)
- **Quality**: Good for structured data
- **Install**: `ollama pull qwen2:1.5b`
- **Best for**: Data extraction, structured queries

### 5. **tinyllama** ⚡⚡⚡⚡
- **Size**: 1.1B parameters
- **Speed**: Fastest (~50-300ms)
- **Quality**: Basic but functional
- **Install**: `ollama pull tinyllama`
- **Best for**: Ultra-fast responses, simple tasks

## How to Change Model

### Option 1: Environment Variable
```bash
export AI_MODEL=phi3:mini
npm run dev
```

### Option 2: Edit Code
Edit `app/main/ai/index.ts` and `app/main/rag/ollama.ts`:
```typescript
model: process.env.AI_MODEL || 'phi3:mini', // Change default here
```

## Performance Optimizations Applied

1. **Reduced Chunks**: 1-2 chunks instead of 2-3
2. **Smaller Prompts**: 2000 tokens max (was 3000)
3. **Limited Response**: 200 tokens max per response
4. **Reduced Temperature**: 0.3 (was 0.7) for faster, focused responses
5. **Context Limit**: 2048 tokens (reduces processing time)
6. **Timeout**: 30 seconds (was 60)

## Speed Comparison (Approximate)

| Model | Response Time | Quality | Use Case |
|-------|--------------|---------|----------|
| llama3.2:1b | 100-500ms | Good | Fast Q&A |
| phi3:mini | 200-800ms | Excellent | Balanced |
| gemma2:2b | 150-600ms | Good | General |
| qwen2:1.5b | 100-500ms | Good | Data extraction |
| tinyllama | 50-300ms | Basic | Ultra-fast |

## Testing Different Models

1. Pull a model:
   ```bash
   ollama pull llama3.2:1b
   ```

2. Set environment variable:
   ```bash
   export AI_MODEL=llama3.2:1b
   ```

3. Restart the app and test response times

## Notes

- Smaller models = faster but may have lower quality
- For data extraction tasks, `llama3.2:1b` or `qwen2:1.5b` work well
- For complex reasoning, `phi3:mini` is a good balance
- All models are open-source and free to use

