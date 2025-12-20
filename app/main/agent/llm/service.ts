// LLM Service - Generic interface for LLM providers

import { eventLogger } from '../../logging/event-logger';
import { checkOllamaConnection, ensureModelLoaded, generateAnswerFromPrompt } from './ollama';

export interface LLMResponse {
  answer: string;
  prompt: string;
}

export interface LLMService {
  generateAnswer(prompt: string): Promise<LLMResponse>;
  checkConnection(): Promise<boolean>;
  ensureModelLoaded(): Promise<void>;
}

// Ollama LLM Service Implementation
class OllamaService implements LLMService {
  async generateAnswer(prompt: string): Promise<LLMResponse> {
    const result = await generateAnswerFromPrompt(prompt);
    return {
      answer: result.answer,
      prompt: result.prompt || prompt,
    };
  }

  async checkConnection(): Promise<boolean> {
    return checkOllamaConnection();
  }

  async ensureModelLoaded(): Promise<void> {
    return ensureModelLoaded();
  }
}

// Default LLM service (Ollama)
let llmService: LLMService = new OllamaService();

export function setLLMService(service: LLMService): void {
  llmService = service;
}

export function getLLMService(): LLMService {
  return llmService;
}

export async function generateAnswer(prompt: string): Promise<LLMResponse> {
  return llmService.generateAnswer(prompt);
}

export async function initializeLLMService(): Promise<void> {
  eventLogger.info('LLM Service', 'Initializing LLM Service...');
  
  // Check Ollama connection
  eventLogger.info('LLM Service', 'Checking Ollama connection...');
  const ollamaAvailable = await llmService.checkConnection();
  if (!ollamaAvailable) {
    eventLogger.warning('LLM Service', 'Ollama not available. LLM features will not work.');
    return;
  }
  
  // Ensure model is loaded
  try {
    await llmService.ensureModelLoaded();
  } catch (error: any) {
    eventLogger.warning('LLM Service', 'Failed to ensure Ollama model is loaded', error.message || error);
    // Don't throw - allow app to continue, LLM will show error when used
  }
  
  eventLogger.success('LLM Service', 'LLM Service initialized successfully');
}

