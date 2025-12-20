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

// IPC Channel definitions - Organized by feature
export const IPCChannels = {
  // Tab management
  tab: {
    create: 'tab:create',
    close: 'tab:close',
    switch: 'tab:switch',
    update: 'tab:update',
    getAll: 'tab:get-all',
  },

  // Navigation
  navigation: {
    navigate: 'navigate',
    goBack: 'go-back',
    goForward: 'go-forward',
    reload: 'reload',
    stopLoading: 'stop-loading',
  },

  // Session management
  session: {
    create: 'session:create',
    get: 'session:get',
    getAll: 'session:get-all',
    getIds: 'session:get-ids',
    delete: 'session:delete',
    getTabId: 'session:get-tab-id',
    navigate: 'session:navigate',
    showView: 'session:show-view',
    updateBounds: 'session:update-bounds',
  },

  // Agent operations
  agent: {
    sendMessage: 'agent:send-message',
  },

  // QA service
  qa: {
    ask: 'qa:ask',
  },

  // DOM extraction
  dom: {
    extract: 'dom:extract',
    content: 'dom:content',
  },

  // Window management
  window: {
    minimize: 'window:minimize',
    maximize: 'window:maximize',
    close: 'window:close',
    resize: 'window:resize',
  },

  // Dev tools
  devTools: {
    open: 'dev-tools:open',
    close: 'dev-tools:close',
  },

  // Logging
  log: {
    getEvents: 'log:get-events',
    clear: 'log:clear',
  },

  // Zoom
  zoom: {
    in: 'zoom:in',
    out: 'zoom:out',
    reset: 'zoom:reset',
  },

  // Utilities
  utils: {
    getTestBookingUrl: 'utils:get-test-booking-url',
  },

  // Events (one-way communication)
  events: {
    tabCreated: 'tab:created',
    tabClosed: 'tab:closed',
    tabUpdated: 'tab:update',
    sessionCreated: 'agent:session-created',
    sessionUpdated: 'agent:session-updated',
    sessionDeleted: 'agent:session-deleted',
    logEvent: 'log:event',
    logClear: 'log:clear',
    commandPaletteToggle: 'command-palette:toggle',
    aiTogglePanel: 'ai:toggle-panel',
    appEvent: 'app-event',
  },
} as const;

// Type helper for channel values
export type IPCChannel = typeof IPCChannels[keyof typeof IPCChannels][keyof typeof IPCChannels[keyof typeof IPCChannels]];

// IPC Message types
export interface IPCMessage<T = any> {
  channel: IPCChannel;
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
