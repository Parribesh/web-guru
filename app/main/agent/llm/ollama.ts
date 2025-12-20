import axios from 'axios';
import { RetrievedContext } from '../../../shared/types';
import { eventLogger } from '../../logging/event-logger';
import { ToolDefinition } from '../../agent/tools';
import { ToolCall, ToolResult } from '../../agent/types';

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

// Legacy function - kept for backward compatibility
// New code should use generateAnswerFromPrompt
export async function generateAnswer(
  question: string,
  context: RetrievedContext,
  pageMetadata: { url: string; title: string }
): Promise<{ answer: string; prompt: string }> {
  const prompt = buildQAPrompt(question, context, pageMetadata);
  return generateAnswerFromPrompt(prompt);
}

// New simplified function - takes only prompt
export async function generateAnswerFromPrompt(
  prompt: string
): Promise<{ answer: string; prompt: string }> {

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
          return { answer: response.data.response, prompt: prompt };
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

// buildQAPrompt moved to agent/prompts/builder.ts
// This function is kept for backward compatibility but should use the prompt builder
export function buildQAPrompt(
  question: string,
  context: RetrievedContext,
  pageMetadata: { url: string; title: string }
): string {
  // Import dynamically to avoid circular dependency
  const { buildPrompt } = require('../prompts/builder');
  return buildPrompt(question, context, pageMetadata);
}

/**
 * Generate answer with tool calling support
 * This function handles AI responses that may include tool calls, executes them, and continues the conversation
 */
export async function generateAnswerWithTools(
  question: string,
  pageContext: string,
  availableTools: ToolDefinition[],
  executeToolCallback: (toolCall: ToolCall) => Promise<ToolResult>
): Promise<{ success: boolean; answer?: string; error?: string }> {
  const maxIterations = 5; // Prevent infinite loops
  let iteration = 0;
  let conversationHistory: Array<{ role: 'user' | 'assistant' | 'tool'; content: string }> = [];
  
  // Format tools for the prompt
  const toolsDescription = availableTools.map(tool => {
    const params = Object.entries(tool.parameters.properties)
      .map(([name, desc]) => `  - ${name} (${desc.type}): ${desc.description}`)
      .join('\n');
    return `${tool.name}: ${tool.description}\nParameters:\n${params}`;
  }).join('\n\n');

  while (iteration < maxIterations) {
    iteration++;
    
    // Build prompt with tools
    const systemPrompt = `You are an AI assistant that can interact with web pages using tools. 
You have access to the following tools:

${toolsDescription}

When the user asks you to perform actions (like filling forms, clicking buttons, etc.), you should:
1. Use the appropriate tools to accomplish the task
2. Format tool calls as JSON: {"tool": "toolName", "params": {"param1": "value1", ...}}
3. After tools are executed, you'll receive the results
4. Continue with the task or provide a summary

Current page context:
${pageContext.substring(0, 1500)}`;

    const userPrompt = question;
    
    // Add conversation history
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: userPrompt }
    ];

    const fullPrompt = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');

    try {
      // Call Ollama
      const response = await axios.post(
        `${OLLAMA_BASE_URL}/api/generate`,
        {
          model: activeModel,
          prompt: fullPrompt,
          stream: false,
          options: {
            temperature: 0.7,
            top_p: 0.9,
          },
        },
        {
          timeout: 60000,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const responseText = response.data.response?.trim() || '';
      
      // Try to parse tool calls from response
      const toolCallMatch = responseText.match(/\{"tool":\s*"([^"]+)",\s*"params":\s*({[^}]+})/);
      
      if (toolCallMatch) {
        const toolName = toolCallMatch[1];
        const paramsStr = toolCallMatch[2];
        
        try {
          const params = JSON.parse(paramsStr);
          const toolCall: ToolCall = {
            id: `tool-${Date.now()}-${Math.random()}`,
            name: toolName,
            params,
            timestamp: Date.now(),
          };
          
          // Execute tool
          const toolResult: ToolResult = await executeToolCallback(toolCall);
          
          // Add to conversation history
          conversationHistory.push({ role: 'assistant', content: responseText });
          conversationHistory.push({ 
            role: 'tool', 
            content: toolResult.success 
              ? JSON.stringify(toolResult.result) 
              : `Error: ${toolResult.error}` 
          });
          
          // Continue conversation with tool result
          question = `Tool executed. Result: ${toolResult.success ? JSON.stringify(toolResult.result) : toolResult.error}. Continue with the task.`;
          continue; // Loop to continue conversation
        } catch (parseError) {
          // If tool call parsing fails, treat as regular response
          return {
            success: true,
            answer: responseText,
          };
        }
      } else {
        // No tool call, return the response
        return {
          success: true,
          answer: responseText,
        };
      }
    } catch (error: any) {
      eventLogger.error('Ollama', 'Tool calling failed', error.message || error);
      return {
        success: false,
        error: error.message || 'Failed to generate answer with tools',
      };
    }
  }
  
  // Max iterations reached
  return {
    success: false,
    error: 'Maximum iterations reached. The task may be too complex.',
  };
}

