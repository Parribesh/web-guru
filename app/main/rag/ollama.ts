import axios from 'axios';
import { QARequest, QAResponse, RetrievedContext } from '../../shared/types';
import { eventLogger } from '../logging/event-logger';

const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
// Use faster model by default - can be overridden with AI_MODEL env var
// Fast options: llama3.2:1b (fastest), phi3:mini, gemma2:2b, qwen2:1.5b
const MODEL_NAME = process.env.AI_MODEL || 'qwen2:1.5b'; // Using qwen2:1.5b for fast data extraction

export async function checkOllamaConnection(): Promise<boolean> {
  try {
    // Try both IPv4 and IPv6 - prioritize explicit IPv4
    const urls = [
      'http://127.0.0.1:11434', // Explicit IPv4 first
      OLLAMA_BASE_URL.replace('localhost', '127.0.0.1'), // Force IPv4 from env
      OLLAMA_BASE_URL,
    ];

    eventLogger.info('Ollama', `Checking Ollama connection... Base URL: ${OLLAMA_BASE_URL}`);
    eventLogger.debug('Ollama', `Will try URLs: ${urls.join(', ')}`);

    for (const url of urls) {
      try {
        eventLogger.debug('Ollama', `Attempting connection to ${url}...`);
        const startTime = Date.now();
        const response = await axios.get(`${url}/api/tags`, {
          timeout: 5000, // Increased timeout
          validateStatus: () => true, // Don't throw on HTTP errors
          headers: {
            'User-Agent': 'Electron-AI-Browser/1.0',
          },
        });
        const duration = Date.now() - startTime;
        
        eventLogger.debug('Ollama', `Response from ${url}: status=${response.status}, duration=${duration}ms`);
        
        if (response.status === 200) {
          eventLogger.success('Ollama', `Connection successful at ${url} (${duration}ms)`);
          return true;
        } else {
          eventLogger.warning('Ollama', `Unexpected status ${response.status} from ${url}`);
        }
      } catch (err: any) {
        const errorDetails = {
          code: err.code,
          message: err.message,
          syscall: err.syscall,
          address: err.address,
          port: err.port,
          errno: err.errno,
          stack: err.stack?.split('\n')[0], // First line of stack
        };
        eventLogger.debug('Ollama', `${url} failed:`, JSON.stringify(errorDetails, null, 2));
        
        // Try next URL
        if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
          continue;
        }
        // If it's a different error, log it but continue
        eventLogger.warning('Ollama', `Unexpected error for ${url}`, err.message);
      }
    }
    
    eventLogger.warning('Ollama', 'Connection failed on all URLs. Please ensure Ollama is running: ollama serve');
    eventLogger.info('Ollama', 'Troubleshooting: Run "curl http://127.0.0.1:11434/api/tags" to verify Ollama is accessible');
    return false;
  } catch (error: any) {
    const errorDetails = {
      code: error.code,
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 3).join('\n'),
    };
    eventLogger.error('Ollama', 'Connection check failed', JSON.stringify(errorDetails, null, 2));
    return false;
  }
}

export async function ensureModelLoaded(): Promise<void> {
  // Try both IPv4 and IPv6 - prioritize IPv4
  const urls = [
    'http://127.0.0.1:11434', // Force IPv4 first
    OLLAMA_BASE_URL.replace('localhost', '127.0.0.1'), // Also try with replaced localhost
    OLLAMA_BASE_URL,
  ];

  let workingUrl = null;

  // Find working URL
  for (const url of urls) {
    try {
      eventLogger.debug('Ollama', `Checking model availability at ${url}...`);
      const response = await axios.get(`${url}/api/tags`, {
        timeout: 5000,
        validateStatus: () => true, // Don't throw on HTTP errors
      });
      if (response.status === 200) {
        workingUrl = url;
        eventLogger.info('Ollama', `Using Ollama at ${url}`);
        break;
      }
    } catch (err: any) {
      eventLogger.debug('Ollama', `${url} failed: ${err.code || err.message}`);
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
        continue;
      }
      throw err;
    }
  }

  if (!workingUrl) {
    throw new Error('Cannot connect to Ollama. Please ensure it is running.');
  }

  try {
    // Check if model is available
    const response = await axios.get(`${workingUrl}/api/tags`, {
      timeout: 5000,
      validateStatus: () => true,
    });
    
    if (response.status !== 200) {
      throw new Error(`Ollama API returned status ${response.status}`);
    }
    
    const models = response.data.models || [];
    const modelExists = models.some((m: any) => m.name === MODEL_NAME);

    if (!modelExists) {
      eventLogger.info('Ollama', `Model ${MODEL_NAME} not found, pulling...`);
      await axios.post(`${workingUrl}/api/pull`, {
        name: MODEL_NAME,
        stream: false,
      }, {
        timeout: 300000, // 5 minutes for model download
        validateStatus: () => true,
      });
      eventLogger.success('Ollama', `Model ${MODEL_NAME} loaded`);
    } else {
      eventLogger.success('Ollama', `Model ${MODEL_NAME} is already available`);
    }
  } catch (error: any) {
    eventLogger.error('Ollama', 'Failed to ensure model is loaded', error.message || error);
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Ollama connection refused. Please ensure Ollama is running: ollama serve');
    }
    throw error;
  }
}

export async function generateAnswer(
  question: string,
  context: RetrievedContext,
  pageMetadata: { url: string; title: string }
): Promise<{ answer: string; prompt: string }> {
  const prompt = buildQAPrompt(question, context, pageMetadata);

  // Try both IPv4 and IPv6 - use the working URL from connection check
  const urls = [
    'http://127.0.0.1:11434', // Force IPv4 first
    OLLAMA_BASE_URL.replace('localhost', '127.0.0.1'), // Also try with replaced localhost
    OLLAMA_BASE_URL,
  ];

  let lastError: any = null;

  for (const url of urls) {
    try {
      eventLogger.debug('Ollama', `Attempting generation at ${url}...`);
      const startTime = Date.now();
      const response = await axios.post(
        `${url}/api/generate`,
        {
          model: MODEL_NAME,
          prompt,
          stream: false,
          options: {
            temperature: 0.3, // Reduced from 0.7 for faster, more focused responses
            top_p: 0.9,
            num_predict: 200, // Limit response length to ~200 tokens for faster generation
            num_ctx: 2048, // Limit context window to reduce processing time
          },
        },
        {
          timeout: 30000, // Reduced from 60s to 30s timeout
          validateStatus: () => true, // Don't throw on HTTP errors
        }
      );

        if (response.status === 200 && response.data.response) {
          const duration = Date.now() - startTime;
          eventLogger.success('Ollama', `Answer generated successfully (${duration}ms)`);
          return { answer: response.data.response, prompt };
      } else {
        eventLogger.warning('Ollama', `Unexpected response from ${url}`, { status: response.status, data: response.data });
        lastError = new Error(`Unexpected response: ${response.status}`);
        continue;
      }
    } catch (error: any) {
      lastError = error;
      eventLogger.debug('Ollama', `${url} failed: ${error.code || error.message}`);
      
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
        // Try next URL
        continue;
      }
      
      // If it's a different error and we're on the last URL, throw
      if (url === urls[urls.length - 1]) {
        eventLogger.error('Ollama', 'Generation failed on all URLs', error.message || error);
        throw error;
      }
    }
  }

  // If we get here, all URLs failed
  eventLogger.error('Ollama', 'Failed to connect to Ollama on any URL', lastError?.message || 'Unknown error');
  throw new Error('Ollama is not running. Please start it with: ollama serve');
}

// Estimate tokens (rough approximation: 1 token ≈ 4 characters)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Limit chunk content to prevent prompt from being too long
// Ollama has a context limit, so we need to be conservative
// Reduced for faster responses
const MAX_PROMPT_TOKENS = 2000; // Reduced from 3000 for faster processing
const MAX_CHARS_PER_CHUNK = 400; // ~100 tokens per chunk max (matches chunking size)

export function buildQAPrompt(
  question: string,
  context: RetrievedContext,
  pageMetadata: { url: string; title: string }
): string {
  // Limit chunks and truncate content to fit within token budget
  let totalChars = 0;
  const questionAndInstructions = `You are an AI assistant answering questions based on specific content from a web page.

PAGE INFORMATION:
Title: ${pageMetadata.title}
URL: ${pageMetadata.url}

USER QUESTION:
${question}

RELEVANT CONTENT FROM THE PAGE (use this information to answer):

INSTRUCTIONS:
1. Answer the question DIRECTLY and ONLY using the relevant content provided above
2. Do NOT make up information or use knowledge outside of the provided content
3. If the content doesn't fully answer the question, say so explicitly
4. When answering questions about numbers, statistics, or data:
   - Use the EXACT numbers from the content
   - Include units (billions, percentages, etc.) when provided
   - Reference the specific table or section where the data appears
   - If multiple numbers are mentioned, be specific about which one answers the question
5. Quote or reference specific parts of the content when relevant
6. Be accurate, concise, and cite which section you're using when helpful
7. For table data, read the table rows carefully and match the question to the correct row/column
8. If the content is about something completely different from the question, clearly state that the content doesn't address the question

Answer based ONLY on the content above:`;

  // Reduced available chars for faster processing
  const availableChars = (MAX_PROMPT_TOKENS * 3) - questionAndInstructions.length - 300; // Reduced safety margin
  
  const limitedChunks: string[] = [];
  for (let i = 0; i < context.primaryChunks.length; i++) {
    const chunk = context.primaryChunks[i];
    const chunkContent = chunk.content || '';
    
    // Chunks should already be split to 400 chars max during chunking
    // If we find a chunk that's too large, log a warning but don't truncate
    if (chunkContent.length > MAX_CHARS_PER_CHUNK * 1.5) {
      eventLogger.warning('Ollama', `Chunk ${i + 1} is ${chunkContent.length} chars (expected max ${MAX_CHARS_PER_CHUNK}). This should have been split during chunking.`);
    }
    
    const heading = chunk.metadata.heading ? `\n### ${chunk.metadata.heading}\n` : '';
    const chunkText = `${heading}[Relevant Content ${i + 1}]\n${chunkContent}\n`;
    
    // Check if adding this chunk would exceed our limit
    if (totalChars + chunkText.length > availableChars) {
      eventLogger.warning('Ollama', `Stopping at chunk ${i + 1}/${context.primaryChunks.length} to stay within token limit`);
      break;
    }
    
    limitedChunks.push(chunkText);
    totalChars += chunkText.length;
  }

  const chunksText = limitedChunks.join('\n---\n\n');
  
  const finalPrompt = questionAndInstructions.replace(
    'RELEVANT CONTENT FROM THE PAGE (use this information to answer):\n',
    `RELEVANT CONTENT FROM THE PAGE (use this information to answer):\n${chunksText}`
  );
  
  const estimatedTokens = estimateTokens(finalPrompt);
  eventLogger.info('Ollama', `Prompt size: ~${estimatedTokens} tokens (${finalPrompt.length} chars), using ${limitedChunks.length}/${context.primaryChunks.length} chunks`);
  
  if (estimatedTokens > MAX_PROMPT_TOKENS) {
    eventLogger.warning('Ollama', `Prompt may exceed token limit (${estimatedTokens} > ${MAX_PROMPT_TOKENS})`);
  }
  
  return finalPrompt;
}

