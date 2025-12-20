// Agent Manager - Manages agent operations for a specific session

import { BrowserView } from 'electron';
import { AgentState, MessageRole, ToolCall, ToolResult } from './types';
import { AgentSessionState } from './AgentSessionState';
import { AgentService } from './AgentService';
import { TabManager } from '../tabs';
import { DOM_TOOLS, executeTool } from './tools';
import { generateAnswerWithTools } from './llm/ollama';
import { answerQuestion } from './qa/service';
import { getCachedContent } from './rag/cache';

export class AgentManager {
  private sessionId: string;
  private tabId: string;
  private tabManager: TabManager;
  private sessionState: AgentSessionState;
  private agentService: AgentService;
  private broadcastCallback: ((session: any) => void) | null = null;

  constructor(
    sessionId: string,
    tabId: string,
    tabManager: TabManager,
    sessionState: AgentSessionState
  ) {
    this.sessionId = sessionId;
    this.tabId = tabId;
    this.tabManager = tabManager;
    this.sessionState = sessionState;
    this.agentService = new AgentService(sessionState);
  }

  setBroadcastCallback(callback: (session: any) => void): void {
    this.broadcastCallback = callback;
  }

  /**
   * Ask a question to the agent using RAG system
   */
  async askQuestion(question: string): Promise<{
    success: boolean;
    answer?: string;
    error?: string;
    relevantChunks?: any[];
    prompt?: string;
  }> {
    const session = this.sessionState.getSession();
    
    // Add user message using AgentService
    this.agentService.addMessage(MessageRole.USER, question);
    this.agentService.updateState(AgentState.THINKING);
    this.broadcastUpdate(session);

    try {
      // Use QA service to get answer
      const qaResponse = await answerQuestion({
        question,
        tabId: this.tabId,
        context: {
          url: session.url || '',
          title: session.title || '',
        },
      });

      if (qaResponse.success) {
        // Add assistant message using AgentService
        const messageId = this.agentService.addMessage(MessageRole.ASSISTANT, qaResponse.answer);
        
        // Store additional data (relevantChunks, prompt, etc.)
        if (qaResponse.relevantChunks) {
          this.agentService.updateMessageData(messageId, {
            relevantChunks: qaResponse.relevantChunks,
            sourceLocation: qaResponse.sourceLocation,
            prompt: qaResponse.prompt,
          });
        }
        
        this.agentService.updateState(AgentState.IDLE);
        this.broadcastUpdate(this.sessionState.getSession());

        return {
          success: true,
          answer: qaResponse.answer,
          relevantChunks: qaResponse.relevantChunks,
          prompt: qaResponse.prompt,
        };
      } else {
        this.agentService.addMessage(MessageRole.ASSISTANT, qaResponse.error || 'Failed to get response');
        this.agentService.updateState(AgentState.IDLE);
        this.broadcastUpdate(this.sessionState.getSession());

        return {
          success: false,
          error: qaResponse.error,
        };
      }
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      this.agentService.addMessage(MessageRole.ASSISTANT, `Error: ${errorMessage}`);
      this.agentService.updateState(AgentState.IDLE);
      this.broadcastUpdate(this.sessionState.getSession());

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Ask a question with tool calling support (for DOM interaction)
   */
  async askQuestionWithTools(question: string): Promise<{
    success: boolean;
    answer?: string;
    error?: string;
  }> {
    const session = this.sessionState.getSession();
    const browserView = this.tabManager.getBrowserView(this.tabId);
    
    if (!browserView) {
      throw new Error(`BrowserView not found for tab ${this.tabId}`);
    }

    // Add user message using AgentService
    this.agentService.addMessage(MessageRole.USER, question);
    this.agentService.updateState(AgentState.THINKING);
    this.broadcastUpdate(session);

    try {
      // Get page content for context
      const cache = getCachedContent(this.tabId);
      
      if (!cache) {
        this.agentService.addMessage(MessageRole.ASSISTANT, 'Page content not cached. Please wait for page to load completely.');
        this.agentService.updateState(AgentState.IDLE);
        this.broadcastUpdate(this.sessionState.getSession());
        return {
          success: false,
          error: 'Page content not cached. Please wait for page to load completely.',
        };
      }

      // Build context from cached content
      const pageContext = cache.pageContent.extractedText.substring(0, 2000);
      
      // Call AI with tool definitions
      const response = await generateAnswerWithTools(
        question,
        pageContext,
        DOM_TOOLS,
        async (toolCall: ToolCall) => {
          // Execute tool
          this.agentService.updateState(AgentState.EXECUTING_TOOL);
          this.broadcastUpdate(this.sessionState.getSession());
          
          const toolResult = await executeTool(toolCall, browserView);
          
          // Add tool call and result using AgentService
          const messageId = this.agentService.addMessage(MessageRole.ASSISTANT, `Executing ${toolCall.name}...`);
          this.agentService.addToolCall(messageId, toolCall);
          this.agentService.addToolResult(messageId, toolResult);
          this.broadcastUpdate(this.sessionState.getSession());
          
          return toolResult;
        }
      );

      // Add final response using AgentService
      this.agentService.addMessage(MessageRole.ASSISTANT, response.answer || response.error || 'Task completed');
      this.agentService.updateState(AgentState.IDLE);
      this.broadcastUpdate(this.sessionState.getSession());

      return {
        success: response.success,
        answer: response.answer,
        error: response.error,
      };
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      this.agentService.addMessage(MessageRole.ASSISTANT, `Error: ${errorMessage}`);
      this.agentService.updateState(AgentState.IDLE);
      this.broadcastUpdate(this.sessionState.getSession());
      
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  getBrowserView(): BrowserView | null {
    return this.tabManager.getBrowserView(this.tabId);
  }

  private broadcastUpdate(session: any): void {
    if (this.broadcastCallback) {
      this.broadcastCallback(session);
    }
  }
}

