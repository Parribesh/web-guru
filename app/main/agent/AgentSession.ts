import { v4 as uuidv4 } from 'uuid';
import { AgentSession, AgentState, AgentMessage, MessageRole, ToolCall, ToolResult } from './types';

export class AgentSessionManager {
  private session: AgentSession | null = null;

  constructor(sessionId: string, initialUrl?: string) {
    this.session = {
      id: sessionId,
      url: initialUrl || '',
      title: 'New Session',
      state: AgentState.IDLE,
      messages: [],
      context: {
        url: initialUrl || '',
        title: 'New Session',
        content: '',
        chunks: [],
        embeddings: []
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {
        totalTokens: 0,
        toolCallsCount: 0
      }
    };
  }

  getSession(): AgentSession | null {
    return this.session;
  }

  updateState(state: AgentState): void {
    if (!this.session) return;
    this.session.state = state;
    this.session.updatedAt = Date.now();
  }

  addMessage(role: MessageRole, content: string, metadata?: AgentMessage['metadata']): string {
    if (!this.session) return '';
    
    const messageId = uuidv4();
    const message: AgentMessage = {
      id: messageId,
      role,
      content,
      timestamp: Date.now(),
      metadata
    };

    this.session.messages.push(message);
    this.session.updatedAt = Date.now();

    if (metadata?.tokens) {
      this.session.metadata!.totalTokens = (this.session.metadata!.totalTokens || 0) + metadata.tokens;
    }

    return messageId;
  }

  addToolCall(toolCall: ToolCall, messageId: string): void {
    if (!this.session) return;

    const message = this.session.messages.find(m => m.id === messageId);
    if (message) {
      if (!message.toolCalls) {
        message.toolCalls = [];
      }
      message.toolCalls.push(toolCall);
      this.session.metadata!.toolCallsCount = (this.session.metadata!.toolCallsCount || 0) + 1;
      this.session.updatedAt = Date.now();
    }
  }

  addToolResult(toolResult: ToolResult, messageId: string): void {
    if (!this.session) return;

    const message = this.session.messages.find(m => m.id === messageId);
    if (message) {
      if (!message.toolResults) {
        message.toolResults = [];
      }
      message.toolResults.push(toolResult);
      this.session.updatedAt = Date.now();
    }
  }

  updateContext(context: Partial<AgentSession['context']>): void {
    if (!this.session) return;
    this.session.context = { ...this.session.context, ...context };
    this.session.updatedAt = Date.now();
  }

  updateUrl(url: string): void {
    if (!this.session) return;
    this.session.url = url;
    this.session.context.url = url;
    this.session.updatedAt = Date.now();
  }

  updateTitle(title: string): void {
    if (!this.session) return;
    this.session.title = title;
    this.session.context.title = title;
    this.session.updatedAt = Date.now();
  }

  destroy(): void {
    this.session = null;
  }
}

