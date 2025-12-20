// Agent Session State - Pure data container for session state (read-only for UI)

import { AgentSession, AgentState, AgentMessage, MessageRole, ToolCall, ToolResult } from './types';

export class AgentSessionState {
  private session: AgentSession;

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

  // Getters only - state is read-only from outside
  getSession(): AgentSession {
    return this.session;
  }

  getId(): string {
    return this.session.id;
  }

  getUrl(): string {
    return this.session.url;
  }

  getTitle(): string {
    return this.session.title;
  }

  getState(): AgentState {
    return this.session.state;
  }

  getMessages(): AgentMessage[] {
    return this.session.messages;
  }

  getContext(): AgentSession['context'] {
    return this.session.context;
  }

  getMetadata(): AgentSession['metadata'] {
    return this.session.metadata;
  }

  getCreatedAt(): number {
    return this.session.createdAt;
  }

  getUpdatedAt(): number {
    return this.session.updatedAt;
  }

  // Internal methods for AgentService to update state
  // These should only be called by AgentService, not directly
  _updateState(state: AgentState): void {
    this.session.state = state;
    this.session.updatedAt = Date.now();
  }

  _addMessage(message: AgentMessage): void {
    this.session.messages.push(message);
    this.session.updatedAt = Date.now();
    if (message.metadata?.tokens) {
      this.session.metadata!.totalTokens = (this.session.metadata!.totalTokens || 0) + message.metadata.tokens;
    }
  }

  _addToolCall(messageId: string, toolCall: ToolCall): void {
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

  _addToolResult(messageId: string, toolResult: ToolResult): void {
    const message = this.session.messages.find(m => m.id === messageId);
    if (message) {
      if (!message.toolResults) {
        message.toolResults = [];
      }
      message.toolResults.push(toolResult);
      this.session.updatedAt = Date.now();
    }
  }

  _updateContext(context: Partial<AgentSession['context']>): void {
    this.session.context = { ...this.session.context, ...context };
    this.session.updatedAt = Date.now();
  }

  _updateUrl(url: string): void {
    this.session.url = url;
    this.session.context.url = url;
    this.session.updatedAt = Date.now();
  }

  _updateTitle(title: string): void {
    this.session.title = title;
    this.session.context.title = title;
    this.session.updatedAt = Date.now();
  }

  _updateMessageData(messageId: string, data: any): void {
    const message = this.session.messages.find(m => m.id === messageId);
    if (message) {
      (message as any).data = data;
      this.session.updatedAt = Date.now();
    }
  }

  _destroy(): void {
    // Clear references
    this.session.messages = [];
    this.session.context = {
      url: '',
      title: '',
      content: '',
      chunks: [],
      embeddings: []
    };
  }
}
