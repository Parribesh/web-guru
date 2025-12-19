// Shared types for Electron AI Browser

export interface Tab {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface BrowserViewConfig {
  url: string;
  partition?: string;
  webSecurity?: boolean;
  nodeIntegration?: boolean;
  contextIsolation?: boolean;
  preload?: string;
}

export interface AIServiceConfig {
  provider: 'openai' | 'anthropic' | 'local' | 'mock' | 'ollama';
  apiKey?: string;
  model?: string;
  endpoint?: string;
}

export interface AIRequest {
  type: 'summarize' | 'analyze' | 'chat' | 'extract' | 'qa';
  content: string;
  tabId?: string; // Add tabId to AIRequest
  context?: {
    url: string;
    title: string;
    selectedText?: string;
  };
  options?: Record<string, any>;
}

// RAG System Types
export interface ContentChunk {
  id: string;
  content: string;
  metadata: {
    sectionId?: string;
    heading?: string;
    position: number; // Character position in original text
    wordCount: number;
    domPath?: string; // CSS selector for highlighting
    surroundingContext?: {
      previousChunk?: string;
      nextChunk?: string;
    };
  };
  embedding?: number[]; // Vector embedding
}

export interface PageContent {
  url: string;
  title: string;
  extractedText: string;
  structure: ContentStructure;
  metadata: {
    extractedAt: number;
    wordCount: number;
    language?: string;
  };
}

export interface ContentStructure {
  sections: Section[];
  headings: Heading[];
}

export interface Section {
  id: string;
  heading?: string;
  level: number; // h1=1, h2=2, etc.
  startIndex: number;
  endIndex: number;
  content: string;
  domPath?: string;
}

export interface Heading {
  level: number;
  text: string;
  position: number;
}

export interface SearchResult {
  chunk: ContentChunk;
  similarity: number; // 0-1 score
  rank: number;
}

export interface RetrievedContext {
  primaryChunks: ContentChunk[];
  surroundingChunks: ContentChunk[];
  sectionContext: {
    heading: string;
    fullSection?: string;
  };
  metadata: {
    totalChunks: number;
    searchTime: number;
  };
}

export interface QARequest {
  question: string;
  tabId: string;
  context?: {
    url: string;
    title: string;
  };
}

export interface QAResponse {
  success: boolean;
  answer: string;
  explanation: string;
  relevantChunks: {
    chunkId: string;
    excerpt: string;
    relevance: string;
  }[];
  confidence: number; // 0-1
  prompt?: string; // The full prompt sent to the LLM
  sourceLocation: {
    section?: string;
    approximatePosition: string;
  };
  metadata?: {
    processingTime?: number;
    chunksSearched?: number;
    model?: string;
  };
  error?: string;
}

export interface AIResponse {
  success: boolean;
  content: string;
  metadata?: {
    tokens?: number;
    model?: string;
    processingTime?: number;
  };
  error?: string;
  prompt?: string; // The full prompt sent to the LLM
  relevantChunks?: {
    chunkId: string;
    excerpt: string;
    relevance: string;
  }[];
  sourceLocation?: {
    section?: string;
    approximatePosition: string;
  };
}

// IPC Channel definitions
export enum IPCChannels {
  // Tab management
  CREATE_TAB = 'tab:create',
  CLOSE_TAB = 'tab:close',
  SWITCH_TAB = 'tab:switch',
  UPDATE_TAB = 'tab:update',

  // Navigation
  NAVIGATE = 'navigate',
  GO_BACK = 'go-back',
  GO_FORWARD = 'go-forward',
  RELOAD = 'reload',
  STOP_LOADING = 'stop-loading',

  // AI services
  AI_REQUEST = 'ai:request',
  AI_RESPONSE = 'ai:response',

  // DOM extraction
  EXTRACT_DOM = 'dom:extract',
  DOM_CONTENT = 'dom:content',

  // Window management
  WINDOW_MINIMIZE = 'window:minimize',
  WINDOW_MAXIMIZE = 'window:maximize',
  WINDOW_CLOSE = 'window:close',
  WINDOW_RESIZE = 'window:resize',

  // Dev tools
  OPEN_DEV_TOOLS = 'dev-tools:open',
  CLOSE_DEV_TOOLS = 'dev-tools:close'
}

// IPC Message types
export interface IPCMessage<T = any> {
  channel: IPCChannels;
  data: T;
}

// Browser events
export interface PageLoadEvent {
  tabId: string;
  url: string;
  title: string;
  isLoading: boolean;
}

export interface DOMContentEvent {
  tabId: string;
  content: string;
  url: string;
  title: string;
}

// Command palette types
export interface Command {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  action: () => void;
  category?: string;
}

export interface CommandPaletteState {
  isOpen: boolean;
  query: string;
  commands: Command[];
  filteredCommands: Command[];
  selectedIndex: number;
}

// UI Component props
export interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewTab: () => void;
}

export interface AddressBarProps {
  url: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onNavigate: (url: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onStop: () => void;
}

export interface AISidePanelProps {
  isOpen: boolean;
  onToggle: () => void;
  onRequest: (request: AIRequest) => void;
  currentResponse?: AIResponse;
  isProcessing: boolean;
}
