# Performance Test Guide - Qwen2:1.5b

## ✅ Model Configuration Complete

- **Model**: `qwen2:1.5b` (1.5 billion parameters)
- **Status**: ✅ Installed and configured
- **Size**: 934 MB
- **Expected Speed**: 100-500ms per response

## 🧪 Test Questions

Use these questions to test performance and accuracy:

1. **"What is the global AI market size in 2024?"**
   - Expected: $184.7 billion
   - Type: Numerical query (will use 2 chunks)

2. **"Which sector has the highest adoption rate?"**
   - Expected: Financial Services with 74.8%
   - Type: Numerical query (will use 2 chunks)

3. **"How much was invested in healthcare AI?"**
   - Expected: $34.2 billion
   - Type: Numerical query (will use 2 chunks)

4. **"What is the projected market size by 2028?"**
   - Expected: $422.5 billion
   - Type: Numerical query (will use 2 chunks)

5. **"Which region has the most AI companies?"**
   - Expected: Asia Pacific with 4,892 companies
   - Type: Numerical query (will use 2 chunks)

## 📊 Performance Metrics to Check

### In EventLog, look for:

1. **Response Time**:
   - Look for: `Answer generated successfully (XXXms)`
   - Target: < 500ms for most queries
   - Previous (llama3.2:latest): 2-5 seconds

2. **Chunk Processing**:
   - `📊 Detected numerical/data query - searching top 2 chunks`
   - `⚡ Using top 1 chunk for faster response` (for non-numerical)

3. **Model Info**:
   - Check that it's using `qwen2:1.5b` in logs

4. **Table Data**:
   - `📊 Found X chunk(s) containing table data`
   - `📊 Chunk X contains table data (Y table rows)`

## 🚀 How to Test

1. **Restart the app** (if running) to load the new model configuration

2. **Wait for page to load**:
   - Dev sample should load automatically
   - Wait for embeddings to generate (check EmbeddingProgress)

3. **Ask test questions**:
   - Type questions in the chat panel
   - Watch EventLog for timing information

4. **Compare performance**:
   - Note response times in EventLog
   - Check answer accuracy
   - Verify table data is being used

## 📈 Expected Improvements

| Metric | Before (llama3.2:latest) | After (qwen2:1.5b) |
|--------|-------------------------|-------------------|
| Response Time | 2-5 seconds | 100-500ms |
| Model Size | 3-7B params | 1.5B params |
| Chunks Used | 2-3 | 1-2 |
| Prompt Size | 3000 tokens | 2000 tokens |
| Speed Improvement | Baseline | **5-10x faster** |

## 🔍 Debugging

If responses are slow or inaccurate:

1. **Check EventLog** for:
   - Model name in logs
   - Response times
   - Chunk matching scores

2. **Verify model is loaded**:
   ```bash
   ollama list | grep qwen2:1.5b
   ```

3. **Test model directly**:
   ```bash
   ollama run qwen2:1.5b "What is 2+2?"
   ```

4. **Check Ollama is running**:
   ```bash
   curl http://127.0.0.1:11434/api/tags
   ```

## 📝 Notes

- Qwen2:1.5b is optimized for:
  - Fast inference
  - Data extraction
  - Structured queries
  - Multilingual support

- The model should handle:
  - Numerical queries well
  - Table data extraction
  - Quick responses
  - Accurate data retrieval

## 🎯 Success Criteria

✅ Response time < 500ms for most queries
✅ Accurate answers with exact numbers
✅ Table data is correctly identified and used
✅ EventLog shows proper chunk matching
✅ No timeout errors

Happy testing! 🚀

