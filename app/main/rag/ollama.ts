import axios from 'axios';
import { QARequest, QAResponse, RetrievedContext } from '../../shared/types';
import { eventLogger } from '../logging/event-logger';

const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
// Use fastest small model by default - can be overridden with AI_MODEL env var
// For RAG tasks, we only need to extract info from chunks, so smallest = fastest
// Priority: llama3.2:1b (fastest, 1B params) > qwen2:1.5b (1.5B params) > phi3:mini (3.8B params)
const DEFAULT_MODEL = process.env.AI_MODEL || 'llama3.2:1b'; // Smallest model for fastest inference
let activeModel = DEFAULT_MODEL; // Will be set during initialization

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
    const modelExists = models.some((m: any) => m.name === DEFAULT_MODEL);

    if (!modelExists) {
      // Try fallback models in order of speed (smallest first)
      const fallbackModels = ['qwen2:1.5b', 'phi3:mini', 'gemma2:2b'];
      let foundModel = DEFAULT_MODEL;
      
      for (const fallback of fallbackModels) {
        const fallbackExists = models.some((m: any) => m.name === fallback);
        if (fallbackExists) {
          foundModel = fallback;
          activeModel = fallback;
          eventLogger.info('Ollama', `Using fallback model: ${fallback} (${DEFAULT_MODEL} not found)`);
          eventLogger.info('Ollama', `${fallback} is available and will be used for faster inference`);
          break;
        }
      }
      
      if (foundModel === DEFAULT_MODEL) {
        eventLogger.info('Ollama', `Model ${DEFAULT_MODEL} not found, pulling...`);
        eventLogger.info('Ollama', 'This is the smallest/fastest model (1B params) for RAG tasks');
        await axios.post(`${workingUrl}/api/pull`, {
          name: DEFAULT_MODEL,
          stream: false,
        }, {
          timeout: 300000, // 5 minutes for model download
          validateStatus: () => true,
        });
        activeModel = DEFAULT_MODEL;
        eventLogger.success('Ollama', `Model ${DEFAULT_MODEL} loaded and ready`);
      }
    } else {
      activeModel = DEFAULT_MODEL;
      eventLogger.success('Ollama', `Model ${DEFAULT_MODEL} is already available (fastest for RAG - 1B params)`);
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
          model: activeModel, // Use the model selected during initialization
          prompt,
          stream: false,
          options: {
            temperature: 0.2, // Lower temperature for faster, more deterministic responses
            top_p: 0.8, // Reduced for faster sampling
            num_predict: 150, // Reduced from 200 to 150 tokens for faster generation
            num_ctx: 1536, // Reduced from 2048 to 1536 to speed up processing
            top_k: 20, // Limit top-k sampling for faster inference
            repeat_penalty: 1.1, // Prevent repetition without slowing down
          },
        },
        {
          timeout: 20000, // Reduced from 30s to 20s timeout for faster failure detection
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
const MAX_PROMPT_TOKENS = 1200; // Reduced from 2000 to 1200 for much faster processing
const MAX_CHARS_PER_CHUNK = 800; // ~200 tokens per chunk max (matches chunking size - increased from 400)

export function buildQAPrompt(
  question: string,
  context: RetrievedContext,
  pageMetadata: { url: string; title: string }
): string {
  // Limit chunks and truncate content to fit within token budget
  let totalChars = 0;
  // More concise prompt for faster processing
  const questionAndInstructions = `Answer this question using ONLY the content below. Be concise and accurate.

Question: ${question}
Page: ${pageMetadata.title}

Content:
`;

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
  
  const finalPrompt = questionAndInstructions + chunksText + '\n\nAnswer:';
  
  const estimatedTokens = estimateTokens(finalPrompt);
  eventLogger.info('Ollama', `Prompt size: ~${estimatedTokens} tokens (${finalPrompt.length} chars), using ${limitedChunks.length}/${context.primaryChunks.length} chunks`);
  
  if (estimatedTokens > MAX_PROMPT_TOKENS) {
    eventLogger.warning('Ollama', `Prompt may exceed token limit (${estimatedTokens} > ${MAX_PROMPT_TOKENS})`);
  }
  
  return finalPrompt;
}

