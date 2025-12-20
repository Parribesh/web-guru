// Agent Service - Handles all agent operations (messages, tools, state updates)

import { v4 as uuidv4 } from 'uuid';
import { AgentState, MessageRole, ToolCall, ToolResult, AgentMessage } from './types';
import { AgentSessionState } from './AgentSessionState';

export class AgentService {
  private sessionState: AgentSessionState;

  constructor(sessionState: AgentSessionState) {
    this.sessionState = sessionState;
  }

  /**
   * Add a message to the session
   */
  addMessage(role: MessageRole, content: string, metadata?: AgentMessage['metadata']): string {
    const messageId = uuidv4();
    const message: AgentMessage = {
      id: messageId,
      role,
      content,
      timestamp: Date.now(),
      metadata
    };

    this.sessionState._addMessage(message);
    return messageId;
  }

  /**
   * Update session state
   */
  updateState(state: AgentState): void {
    this.sessionState._updateState(state);
  }

  /**
   * Add a tool call to a message
   */
  addToolCall(messageId: string, toolCall: ToolCall): void {
    this.sessionState._addToolCall(messageId, toolCall);
  }

  /**
   * Add a tool result to a message
   */
  addToolResult(messageId: string, toolResult: ToolResult): void {
    this.sessionState._addToolResult(messageId, toolResult);
  }

  /**
   * Update session context
   */
  updateContext(context: Partial<import('./types').AgentSession['context']>): void {
    this.sessionState._updateContext(context);
  }

  /**
   * Update session URL
   */
  updateUrl(url: string): void {
    this.sessionState._updateUrl(url);
  }

  /**
   * Update session title
   */
  updateTitle(title: string): void {
    this.sessionState._updateTitle(title);
  }

  /**
   * Update message data (for storing additional metadata like relevantChunks, prompt, etc.)
   */
  updateMessageData(messageId: string, data: any): void {
    this.sessionState._updateMessageData(messageId, data);
  }

  /**
   * Get the session state (for reading)
   */
  getSessionState(): AgentSessionState {
    return this.sessionState;
  }
}

