import { contextBridge, ipcRenderer } from 'electron';
import { IPCChannels, AIRequest, AIResponse, Tab } from '../shared/types';

// Security: Only expose specific, safe APIs to the renderer
const electronAPI = {
  // Tab management
  tabs: {
    create: (url?: string) => ipcRenderer.invoke(IPCChannels.CREATE_TAB, url),
    close: (tabId: string) => ipcRenderer.invoke(IPCChannels.CLOSE_TAB, tabId),
    switch: (tabId: string) => ipcRenderer.invoke(IPCChannels.SWITCH_TAB, tabId),
    getAll: () => ipcRenderer.invoke('get-tabs'),
  },

  // Navigation
  navigation: {
    go: (tabId: string, url: string) => ipcRenderer.invoke(IPCChannels.NAVIGATE, tabId, url),
    back: (tabId: string) => ipcRenderer.invoke(IPCChannels.GO_BACK, tabId),
    forward: (tabId: string) => ipcRenderer.invoke(IPCChannels.GO_FORWARD, tabId),
    reload: (tabId: string) => ipcRenderer.invoke(IPCChannels.RELOAD, tabId),
    stop: (tabId: string) => ipcRenderer.invoke(IPCChannels.STOP_LOADING, tabId),
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
    open: (tabId?: string) => ipcRenderer.invoke(IPCChannels.OPEN_DEV_TOOLS, tabId),
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
      return selection ? selection.toString() : '';
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
      'tab:update',
      'tab:created',
      'tab:closed',
      'ai:response',
      'dom:extract',
      'command-palette:toggle',
      'ai:toggle-panel',
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
    ipcRenderer.send('app-event', eventType, data);
  },
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// DOM content extraction functions
function extractPageContent(): string {
  // Remove script and style elements
  const clonedDoc = document.cloneNode(true) as Document;

  // Remove scripts and styles
  const scripts = clonedDoc.querySelectorAll('script, style, noscript');
  scripts.forEach(el => el.remove());

  // Extract text content from meaningful elements
  const contentSelectors = [
    'article',
    'main',
    '[role="main"]',
    '.content',
    '.post',
    '.article',
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'li',
    'blockquote'
  ];

  let content = '';

  contentSelectors.forEach(selector => {
    const elements = clonedDoc.querySelectorAll(selector);
    elements.forEach(el => {
      const text = el.textContent?.trim();
      if (text && text.length > 20) { // Only include substantial text
        content += text + '\n\n';
      }
    });
  });

  // Fallback to body text if no structured content found
  if (!content.trim()) {
    content = clonedDoc.body?.textContent || '';
  }

  // Clean up whitespace
  return content
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
}

// Auto-extract content when page loads (for AI analysis)
window.addEventListener('load', async () => {
  try {
    const content = extractPageContent();
    const pageInfo = electronAPI.dom.getPageInfo();

    // Send to main process for AI processing
    await ipcRenderer.invoke(IPCChannels.DOM_CONTENT, {
      tabId: getCurrentTabId(), // TODO: Get actual tab ID
      content,
      url: pageInfo.url,
      title: pageInfo.title,
    });
  } catch (error) {
    console.error('Failed to extract DOM content:', error);
  }
});

// Helper function to get current tab ID (placeholder)
function getCurrentTabId(): string {
  // TODO: Implement proper tab ID tracking
  return 'current-tab';
}

// Handle keyboard shortcuts
document.addEventListener('keydown', (event) => {
  // Command palette shortcut
  if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
    event.preventDefault();
    ipcRenderer.send('command-palette:toggle');
  }

  // AI panel toggle
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'A') {
    event.preventDefault();
    ipcRenderer.send('ai:toggle-panel');
  }
});

// Export types for TypeScript
declare global {
  interface Window {
    electronAPI: typeof electronAPI;
  }
}
