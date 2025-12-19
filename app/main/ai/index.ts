import { AIRequest, AIResponse, AIServiceConfig, QARequest, QAResponse } from '../../shared/types';
import { answerQuestion, initializeQAService } from '../rag/qa-service';
import { eventLogger } from '../logging/event-logger';

// TODO: Implement actual AI service integration
// This is a placeholder implementation

let aiConfig: AIServiceConfig | null = null;

export async function setupAIService(): Promise<void> {
  // TODO: Load AI configuration from settings
  // Default to faster model - can be overridden with AI_MODEL env var
  // Fast models: llama3.2:1b, phi3:mini, gemma2:2b, qwen2:1.5b
  aiConfig = {
    provider: process.env.AI_PROVIDER as any || 'ollama',
    apiKey: process.env.AI_API_KEY,
    model: process.env.AI_MODEL || 'qwen2:1.5b', // Using qwen2:1.5b for fast data extraction
    endpoint: process.env.OLLAMA_URL || 'http://localhost:11434',
  };

  console.log('AI Service initialized:', aiConfig.provider);

  // Initialize QA service if using Ollama
  if (aiConfig.provider === 'ollama' || aiConfig.provider === 'local') {
    try {
      await initializeQAService();
    } catch (error) {
      console.error('Failed to initialize QA service:', error);
    }
  }
}

export async function processAIRequest(request: AIRequest): Promise<AIResponse> {
  try {
    eventLogger.info('AI Service', `Processing ${request.type} request...`);
    eventLogger.info('AI Service', `Content: "${request.content.substring(0, 100)}${request.content.length > 100 ? '...' : ''}"`);
    
    // Check if we should use RAG system for this request
    // Use RAG if:
    // 1. It's explicitly a QA request, OR
    // 2. It's a chat request with a tabId and context (meaning it's about the current page)
    const shouldUseRAG = request.type === 'qa' || 
                        (request.type === 'chat' && request.tabId && request.context?.url);
    
    if (shouldUseRAG) {
      // Get actual tabId - prefer from request, fallback to context URL as identifier
      const tabId = request.tabId || request.context?.url || 'unknown';
      
      eventLogger.info('AI Service', `Using RAG system for ${request.type} request`);
      eventLogger.info('AI Service', `Tab ID: ${tabId}`);
      
      const qaRequest: QARequest = {
        question: request.content,
        tabId: tabId,
        context: request.context,
      };
      
      try {
        const qaResponse = await answerQuestion(qaRequest);
        
        // Convert QAResponse to AIResponse
        if (qaResponse.success) {
          eventLogger.success('AI Service', 'RAG-based answer generated successfully');
          eventLogger.info('AI Service', `Confidence: ${(qaResponse.confidence * 100).toFixed(1)}%`);
        } else {
          const errorMsg = qaResponse.error || 'Unknown error';
          eventLogger.error('AI Service', `RAG request failed: ${errorMsg}`);
          eventLogger.warning('AI Service', 'RAG request completed with errors', errorMsg);
        }
        
        return {
          success: qaResponse.success,
          content: qaResponse.answer,
          metadata: qaResponse.metadata,
          error: qaResponse.error,
          prompt: qaResponse.prompt, // Include the prompt
          relevantChunks: qaResponse.relevantChunks,
          sourceLocation: qaResponse.sourceLocation,
        };
      } catch (error: any) {
        eventLogger.error('AI Service', 'RAG request failed', error.message || error);
        return {
          success: false,
          content: '',
          error: error.message || 'RAG request failed',
        };
      }
    }

    // Handle other request types
    let response: AIResponse;
    switch (aiConfig?.provider) {
      case 'openai':
        response = await processOpenAIRequest(request);
        break;
      case 'anthropic':
        response = await processAnthropicRequest(request);
        break;
      case 'ollama':
      case 'local':
        response = await processOllamaRequest(request);
        break;
      case 'mock':
      default:
        response = await processMockRequest(request);
        break;
    }
    
    if (response.success) {
      eventLogger.success('AI Service', `${request.type} request completed successfully`);
    } else {
      eventLogger.error('AI Service', `${request.type} request failed`, response.error || 'Unknown error');
    }
    
    return response;
  } catch (error: any) {
    eventLogger.error('AI Service', 'AI request failed with exception', error.message || error);
    return {
      success: false,
      content: '',
      error: error instanceof Error ? error.message : 'Unknown AI error'
    };
  }
}

async function processOpenAIRequest(request: AIRequest): Promise<AIResponse> {
  // TODO: Implement OpenAI API integration
  // This would use the OpenAI SDK to make API calls

  const startTime = Date.now();

  // Placeholder response
  return {
    success: true,
    content: `OpenAI response for: ${request.type} - ${request.content.substring(0, 100)}...`,
    metadata: {
      model: aiConfig?.model,
      processingTime: Date.now() - startTime,
      tokens: Math.floor(request.content.length / 4) // Rough estimate
    }
  };
}

async function processAnthropicRequest(request: AIRequest): Promise<AIResponse> {
  // TODO: Implement Anthropic Claude API integration

  const startTime = Date.now();

  return {
    success: true,
    content: `Claude response for: ${request.type} - ${request.content.substring(0, 100)}...`,
    metadata: {
      model: aiConfig?.model,
      processingTime: Date.now() - startTime,
      tokens: Math.floor(request.content.length / 4)
    }
  };
}

async function processOllamaRequest(request: AIRequest): Promise<AIResponse> {
  const axios = require('axios');
  const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
  // Use faster model - same as QA service
  const MODEL = process.env.AI_MODEL || aiConfig?.model || 'llama3.2:1b';

  const startTime = Date.now();

  try {
    const prompt = buildPrompt(request);
    
    // Try both IPv4 and IPv6 - prioritize IPv4 (same as QA service)
    const urls = [
      'http://127.0.0.1:11434', // Force IPv4 first
      OLLAMA_BASE_URL.replace('localhost', '127.0.0.1'), // Also try with replaced localhost
      OLLAMA_BASE_URL,
    ];

    let lastError: any = null;
    let response: any = null;

    eventLogger.info('AI Chat', `Processing ${request.type} request using Ollama...`);

    for (const url of urls) {
      try {
        eventLogger.debug('AI Chat', `Attempting Ollama request at ${url}...`);
        const startTime = Date.now();
        response = await axios.post(
          `${url}/api/generate`,
          {
            model: MODEL,
            prompt,
            stream: false,
            options: {
              temperature: 0.3, // Reduced for faster responses
              num_predict: 200, // Limit response length
              num_ctx: 2048, // Limit context window
            },
          },
          {
            timeout: 30000, // Reduced timeout
            validateStatus: () => true, // Don't throw on HTTP errors
          }
        );

        eventLogger.debug('AI Chat', `Response from ${url}: status=${response.status}`);

        if (response.status === 200 && response.data.response) {
          const duration = Date.now() - startTime;
          eventLogger.success('AI Chat', `Ollama response received (${duration}ms)`);
          return {
            success: true,
            content: response.data.response || '',
            metadata: {
              model: MODEL,
              processingTime: duration,
              tokens: response.data.eval_count || 0,
            },
          };
        } else {
          eventLogger.warning('AI Chat', `Unexpected response from ${url}`, {
            status: response.status,
            hasResponse: !!response.data?.response,
            data: response.data,
          });
          lastError = new Error(`Unexpected response: ${response.status}`);
          continue;
        }
      } catch (error: any) {
        lastError = error;
        const errorDetails = {
          code: error.code,
          message: error.message,
          syscall: error.syscall,
          address: error.address,
          port: error.port,
        };
        eventLogger.debug('AI Chat', `${url} failed:`, JSON.stringify(errorDetails, null, 2));
        
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
          // Try next URL
          continue;
        }
        
        // If it's a different error and we're on the last URL, throw
        if (url === urls[urls.length - 1]) {
          eventLogger.error('AI Chat', 'Ollama request failed on all URLs', error.message || error);
          throw error;
        }
      }
    }

    // If we get here, all URLs failed
    const errorMessage = lastError?.message || 'Unknown error';
    eventLogger.error('AI Chat', 'Failed to connect to Ollama on any URL', errorMessage);
    
    return {
      success: false,
      content: '',
      error: `Ollama connection failed: ${errorMessage}. Please ensure Ollama is running: ollama serve`,
      metadata: {
        processingTime: Date.now() - startTime,
      },
    };
  } catch (error: any) {
    const errorDetails = {
      message: error.message,
      code: error.code,
      syscall: error.syscall,
      address: error.address,
      port: error.port,
    };
    eventLogger.error('AI Chat', 'Ollama request failed with exception', JSON.stringify(errorDetails, null, 2));
    
    return {
      success: false,
      content: '',
      error: error instanceof Error ? error.message : 'Ollama request failed',
      metadata: {
        processingTime: Date.now() - startTime,
      },
    };
  }
}

function buildPrompt(request: AIRequest): string {
  const context = request.context 
    ? `\nContext: Page "${request.context.title}" (${request.context.url})\n`
    : '';

  switch (request.type) {
    case 'summarize':
      return `Summarize the following content in 3-5 bullet points:${context}\n\n${request.content}`;
    case 'analyze':
      return `Analyze the following content:${context}\n\n${request.content}`;
    case 'chat':
      return `${context}\n\nUser: ${request.content}\n\nAssistant:`;
    case 'extract':
      return `Extract key information from:${context}\n\n${request.content}`;
    default:
      return `${context}\n\n${request.content}`;
  }
}

async function processLocalRequest(request: AIRequest): Promise<AIResponse> {
  // Alias to Ollama
  return processOllamaRequest(request);
}

async function processMockRequest(request: AIRequest): Promise<AIResponse> {
  // Mock implementation for development/testing
  const startTime = Date.now();

  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 1000));

  let mockResponse = '';

  switch (request.type) {
    case 'summarize':
      mockResponse = `This is a mock summary of the content. The page appears to be about ${request.context?.title || 'a topic'}. Key points include: AI integration, browser functionality, and user experience enhancements.`;
      break;
    case 'analyze':
      mockResponse = `Analysis complete. This content contains approximately ${request.content.split(' ').length} words. Sentiment appears neutral. Main topics: technology, web browsing, artificial intelligence.`;
      break;
    case 'chat':
      mockResponse = `Hello! I'm the AI assistant for this browser. You asked: "${request.content}". This is a mock response - full AI integration coming soon!`;
      break;
    case 'extract':
      mockResponse = `Extracted key information: URL: ${request.context?.url}, Title: ${request.context?.title}. Selected text: ${request.context?.selectedText || 'None'}.`;
      break;
    default:
      mockResponse = `Mock response for ${request.type}: ${request.content.substring(0, 200)}...`;
  }

  return {
    success: true,
    content: mockResponse,
    metadata: {
      model: 'mock-gpt',
      processingTime: Date.now() - startTime,
      tokens: Math.floor(request.content.length / 4)
    }
  };
}
