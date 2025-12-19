// Agent System Types

export enum AgentState {
  IDLE = 'idle',
  THINKING = 'thinking',
  EXECUTING_TOOL = 'executing_tool',
  WAITING_INPUT = 'waiting_input',
  ERROR = 'error',
  COMPLETED = 'completed'
}

export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
  TOOL = 'tool'
}

export interface AgentMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  metadata?: {
    tokens?: number;
    model?: string;
    processingTime?: number;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  params: Record<string, any>;
  timestamp: number;
}

export interface ToolResult {
  toolCallId: string;
  success: boolean;
  result?: any;
  error?: string;
  timestamp: number;
}

export interface AgentSession {
  id: string;
  url: string;
  title: string;
  state: AgentState;
  messages: AgentMessage[];
  context: {
    url: string;
    title: string;
    content?: string;
    chunks?: any[]; // ContentChunk[]
    embeddings?: number[][];
  };
  createdAt: number;
  updatedAt: number;
  metadata?: {
    totalTokens?: number;
    toolCallsCount?: number;
  };
}

export interface SessionCreateRequest {
  url?: string;
  initialMessage?: string;
}

export interface SessionUpdate {
  sessionId: string;
  state?: AgentState;
  message?: AgentMessage;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  context?: Partial<AgentSession['context']>;
}

