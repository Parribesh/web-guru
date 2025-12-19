/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/* eslint-env browser */
/* global window, document */
import { contextBridge, ipcRenderer } from "electron";

// Define types directly to avoid import issues in sandboxed VM
interface Tab {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

interface AIRequest {
  type: 'summarize' | 'analyze' | 'chat' | 'extract';
  content: string;
  context?: {
    url: string;
    title: string;
    selectedText?: string;
  };
  options?: Record<string, any>;
}

interface AIResponse {
  success: boolean;
  content: string;
  metadata?: {
    tokens?: number;
    model?: string;
    processingTime?: number;
  };
  error?: string;
}

enum IPCChannels {
  CREATE_TAB = 'tab:create',
  CLOSE_TAB = 'tab:close',
  SWITCH_TAB = 'tab:switch',
  UPDATE_TAB = 'tab:update',
  NAVIGATE = 'navigate',
  GO_BACK = 'go-back',
  GO_FORWARD = 'go-forward',
  RELOAD = 'reload',
  STOP_LOADING = 'stop-loading',
  AI_REQUEST = 'ai:request',
  AI_RESPONSE = 'ai:response',
  EXTRACT_DOM = 'dom:extract',
  DOM_CONTENT = 'dom:content',
  WINDOW_MINIMIZE = 'window:minimize',
  WINDOW_MAXIMIZE = 'window:maximize',
  WINDOW_CLOSE = 'window:close',
  WINDOW_RESIZE = 'window:resize',
  OPEN_DEV_TOOLS = 'dev-tools:open',
  CLOSE_DEV_TOOLS = 'dev-tools:close'
}

// Security: Only expose specific, safe APIs to the renderer
const electronAPI = {
  // Tab management
  tabs: {
    create: (url?: string) => ipcRenderer.invoke(IPCChannels.CREATE_TAB, url),
    close: (tabId: string) => ipcRenderer.invoke(IPCChannels.CLOSE_TAB, tabId),
    switch: (tabId: string) =>
      ipcRenderer.invoke(IPCChannels.SWITCH_TAB, tabId),
    getAll: () => ipcRenderer.invoke("get-tabs"),
  },

  // Navigation
  navigation: {
    go: (tabId: string, url: string) =>
      ipcRenderer.invoke(IPCChannels.NAVIGATE, tabId, url),
    back: (tabId: string) => ipcRenderer.invoke(IPCChannels.GO_BACK, tabId),
    forward: (tabId: string) =>
      ipcRenderer.invoke(IPCChannels.GO_FORWARD, tabId),
    reload: (tabId: string) => ipcRenderer.invoke(IPCChannels.RELOAD, tabId),
    stop: (tabId: string) =>
      ipcRenderer.invoke(IPCChannels.STOP_LOADING, tabId),
  },

  // AI services
  ai: {
    request: (request: AIRequest): Promise<AIResponse> =>
      ipcRenderer.invoke(IPCChannels.AI_REQUEST, request),
  },

  // Window management
  window: {
    minimize: () => ipcRenderer.invoke(IPCChannels.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.invoke(IPCChannels.WINDOW_MAXIMIZE),
    close: () => ipcRenderer.invoke(IPCChannels.WINDOW_CLOSE),
  },

  // Dev tools
  devTools: {
    open: (tabId?: string) =>
      ipcRenderer.invoke(IPCChannels.OPEN_DEV_TOOLS, tabId),
  },

  // DOM content extraction
  dom: {
    extractContent: (): Promise<string> => {
      return new Promise((resolve) => {
        // Extract readable content from the page
        const content = extractPageContent();
        resolve(content);
      });
    },

    getSelectedText: (): string => {
      const selection = window.getSelection();
      return selection ? selection.toString() : "";
    },

    getPageInfo: () => ({
      title: document.title,
      url: window.location.href,
      selectedText: electronAPI.dom.getSelectedText(),
    }),
  },

  // Event listeners
  on: (channel: string, callback: (...args: any[]) => void) => {
    // Security: Only allow specific channels
    const allowedChannels = [
      "tab:update",
      "tab:created",
      "tab:closed",
      "ai:response",
      "dom:extract",
      "command-palette:toggle",
      "ai:toggle-panel",
    ];

    if (allowedChannels.includes(channel)) {
      ipcRenderer.on(channel, callback);
    }
  },

  off: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.off(channel, callback);
  },

  // Send app events to main process
  sendAppEvent: (eventType: string, data: any) => {
    ipcRenderer.send("app-event", eventType, data);
  },
};

// Expose the API to the renderer process
// contextBridge may not be available in all contexts (like BrowserViews)
try {
  if (typeof contextBridge !== 'undefined') {
    contextBridge.exposeInMainWorld("electronAPI", electronAPI);
  }
} catch (error) {
  console.warn('contextBridge not available in this context');
}

// DOM content extraction functions
function extractPageContent(): string {
  // Remove script and style elements
  const clonedDoc = document.cloneNode(true) as Document;

  // Remove scripts and styles
  const scripts = clonedDoc.querySelectorAll("script, style, noscript");
  scripts.forEach((el: any) => (el as any).remove());

  // Extract text content from meaningful elements
  const contentSelectors = [
    "article",
    "main",
    '[role="main"]',
    ".content",
    ".post",
    ".article",
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "li",
    "blockquote",
  ];

  let content = "";

  contentSelectors.forEach((selector) => {
    const elements = clonedDoc.querySelectorAll(selector) as any;
    elements.forEach((el: any) => {
      const text = (el.textContent as string | null)?.trim();
      if (text && text.length > 20) {
        // Only include substantial text
        content += text + "\n\n";
      }
    });
  });

  // Fallback to body text if no structured content found
  if (!content.trim()) {
    content = (clonedDoc as any).body?.textContent || "";
  }

  // Clean up whitespace
  return content
    .replace(/\s+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .trim();
}

// Auto-extract content when page loads (for AI analysis)
if (typeof window !== 'undefined') {
  window.addEventListener("load", async () => {
    try {
      const content = extractPageContent();
      const pageInfo = {
        url: window.location.href,
        title: document.title,
        selectedText: '' // Can't get selection in preload context
      };

      // Send to main process for AI processing
      await ipcRenderer.invoke(IPCChannels.DOM_CONTENT, {
        tabId: getCurrentTabId(), // TODO: Get actual tab ID
        content,
        url: pageInfo.url,
        title: pageInfo.title,
      });
    } catch (error) {
      console.error("Failed to extract DOM content:", error);
    }
  });
}

// Helper function to get current tab ID (placeholder)
function getCurrentTabId(): string {
  // TODO: Implement proper tab ID tracking
  return "current-tab";
}

// Handle keyboard shortcuts (only if document is available)
if (typeof document !== 'undefined') {
  document.addEventListener("keydown", (event: any) => {
    // Command palette shortcut
    if ((event.ctrlKey || event.metaKey) && event.key === "k") {
      event.preventDefault();
      ipcRenderer.send("command-palette:toggle");
    }

    // AI panel toggle
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === "A") {
      event.preventDefault();
      ipcRenderer.send("ai:toggle-panel");
    }

    // Zoom shortcuts (fallback if global shortcuts don't work)
    if ((event.ctrlKey || event.metaKey)) {
      if (event.key === "=" || event.key === "+") {
        console.log('Preload: Zoom in triggered, preventing default');
        event.preventDefault();
        ipcRenderer.send("zoom-in");
      } else if (event.key === "-") {
        console.log('Preload: Zoom out triggered, preventing default');
        event.preventDefault();
        ipcRenderer.send("zoom-out");
      } else if (event.key === "0") {
        console.log('Preload: Zoom reset triggered, preventing default');
        event.preventDefault();
        ipcRenderer.send("zoom-reset");
      }
    }
  });
}

// Export types for TypeScript
declare global {
  interface Window {
    electronAPI: typeof electronAPI;
  }
}
