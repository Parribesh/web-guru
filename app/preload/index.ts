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

// Import IPCChannels from shared types (will be available at runtime)
// For preload, we'll use the channel strings directly since we can't import from shared
const IPCChannels = {
  tab: {
    create: 'tab:create',
    close: 'tab:close',
    switch: 'tab:switch',
    update: 'tab:update',
    getAll: 'tab:get-all',
  },
  navigation: {
    navigate: 'navigation:navigate',
    goBack: 'navigation:go-back',
    goForward: 'navigation:go-forward',
    reload: 'navigation:reload',
    stopLoading: 'navigation:stop-loading',
  },
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
    getChunks: 'session:get-chunks',
  },
  agent: {
    sendMessage: 'agent:send-message',
  },
  qa: {
    ask: 'qa:ask',
  },
  dom: {
    extract: 'dom:extract',
    content: 'dom:content',
  },
  window: {
    minimize: 'window:minimize',
    maximize: 'window:maximize',
    close: 'window:close',
    resize: 'window:resize',
  },
  devTools: {
    open: 'dev-tools:open',
    close: 'dev-tools:close',
  },
  log: {
    getEvents: 'log:get-events',
    clear: 'log:clear',
  },
  zoom: {
    in: 'zoom:in',
    out: 'zoom:out',
    reset: 'zoom:reset',
  },
  utils: {
    getTestBookingUrl: 'utils:get-test-booking-url',
  },
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
};

// Security: Only expose specific, safe APIs to the renderer
const electronAPI = {
  // Tab management
  tabs: {
    create: (url?: string) => ipcRenderer.invoke(IPCChannels.tab.create, url),
    close: (tabId: string) => ipcRenderer.invoke(IPCChannels.tab.close, tabId),
    switch: (tabId: string) =>
      ipcRenderer.invoke(IPCChannels.tab.switch, tabId),
    getAll: () => ipcRenderer.invoke(IPCChannels.tab.getAll),
  },

  // Navigation
  navigation: {
    go: (tabId: string, url: string) =>
      ipcRenderer.invoke(IPCChannels.navigation.navigate, tabId, url),
    back: (tabId: string) => ipcRenderer.invoke(IPCChannels.navigation.goBack, tabId),
    forward: (tabId: string) =>
      ipcRenderer.invoke(IPCChannels.navigation.goForward, tabId),
    reload: (tabId: string) => ipcRenderer.invoke(IPCChannels.navigation.reload, tabId),
    stop: (tabId: string) =>
      ipcRenderer.invoke(IPCChannels.navigation.stopLoading, tabId),
  },

  // QA services
  qa: {
    ask: (request: { question: string; tabId: string; context?: { url: string; title: string } }) =>
      ipcRenderer.invoke(IPCChannels.qa.ask, request),
  },

  // Session Management
  sessions: {
    create: (request?: { url?: string; initialMessage?: string }) =>
      ipcRenderer.invoke(IPCChannels.session.create, request),
    get: (sessionId: string) =>
      ipcRenderer.invoke(IPCChannels.session.get, sessionId),
    getAll: () =>
      ipcRenderer.invoke(IPCChannels.session.getAll),
    getSessionIds: () =>
      ipcRenderer.invoke(IPCChannels.session.getIds),
    delete: (sessionId: string) =>
      ipcRenderer.invoke(IPCChannels.session.delete, sessionId),
    navigate: (sessionId: string, url: string) =>
      ipcRenderer.invoke(IPCChannels.session.navigate, sessionId, url),
    showView: (sessionId: string | null) =>
      ipcRenderer.invoke(IPCChannels.session.showView, sessionId),
    updateViewBounds: (sessionId: string, bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke(IPCChannels.session.updateBounds, sessionId, bounds),
    getTabId: (sessionId: string) =>
      ipcRenderer.invoke(IPCChannels.session.getTabId, sessionId),
    getChunks: (sessionId: string) =>
      ipcRenderer.invoke(IPCChannels.session.getChunks, sessionId),
  },

  // Agent Operations
  agent: {
    sendMessage: (sessionId: string, content: string) =>
      ipcRenderer.invoke(IPCChannels.agent.sendMessage, sessionId, content),
  },

  // Utility functions
  utils: {
    getTestBookingUrl: () =>
      ipcRenderer.invoke(IPCChannels.utils.getTestBookingUrl),
  },

  // Logging services
  log: {
    getEvents: () => ipcRenderer.invoke(IPCChannels.log.getEvents),
    clear: () => ipcRenderer.invoke(IPCChannels.log.clear),
  },

  // Window management
  window: {
    minimize: () => ipcRenderer.invoke(IPCChannels.window.minimize),
    maximize: () => ipcRenderer.invoke(IPCChannels.window.maximize),
    close: () => ipcRenderer.invoke(IPCChannels.window.close),
  },

  // Dev tools
  devTools: {
    open: (tabId?: string) =>
      ipcRenderer.invoke(IPCChannels.devTools.open, tabId),
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
      IPCChannels.tab.update,
      IPCChannels.events.tabCreated,
      IPCChannels.events.tabClosed,
      IPCChannels.dom.extract,
      IPCChannels.events.commandPaletteToggle,
      IPCChannels.events.aiTogglePanel,
      IPCChannels.events.logEvent,
      IPCChannels.log.clear,
      IPCChannels.events.sessionCreated,
      IPCChannels.events.sessionUpdated,
      IPCChannels.events.sessionDeleted,
    ];

    if (allowedChannels.includes(channel)) {
      // Wrap callback to forward only the data (not the IPC event object)
      ipcRenderer.on(channel, (ipcEvent, ...args) => {
        console.log(`[Preload] Received event on channel ${channel}:`, args.length, 'args');
        // Forward only the data arguments to the callback
        callback(...args);
      });
      console.log(`[Preload] Registered listener for channel: ${channel}`);
    } else {
      console.warn(`[Preload] Channel not allowed: ${channel}`);
    }
  },

  off: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.off(channel, callback);
  },

  // Send app events to main process
  sendAppEvent: (eventType: string, data: any) => {
    ipcRenderer.send(IPCChannels.events.appEvent, eventType, data);
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

  // Remove scripts, styles, and navigation/sidebar elements
  const toRemove = clonedDoc.querySelectorAll(
    "script, style, noscript, nav, aside, header, footer, " +
    ".nav, .navigation, .sidebar, .menu, .sidebar-content, " +
    ".mw-navigation, .vector-menu, .vector-page-toolbar, " +
    ".infobox, .sidebar-box, .navbox, .vertical-navbox"
  );
  toRemove.forEach((el: any) => (el as any).remove());

  // Try to find main content area first (Wikipedia, news sites, etc.)
  let content = "";
  
  // Priority 1: Article or main content
  const mainContent = clonedDoc.querySelector("article, main, [role='main'], #content, #mw-content-text, .mw-parser-output");
  if (mainContent) {
    // Remove navigation and sidebar elements from main content
    const navElements = mainContent.querySelectorAll("nav, .nav, .navigation, .sidebar, .infobox, .navbox");
    navElements.forEach((el: any) => (el as any).remove());
    
    // Extract text from main content (paragraphs, headings, lists)
    const paragraphs = mainContent.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt");
    paragraphs.forEach((el: any) => {
      const text = (el.textContent as string | null)?.trim();
      if (text && text.length > 30) { // Minimum 30 chars to avoid short labels
        content += text + "\n\n";
      }
    });
    
    // Extract table data - important for numerical data and statistics
    const tables = mainContent.querySelectorAll("table");
    tables.forEach((table: any) => {
      const rows = table.querySelectorAll("tr");
      if (rows.length > 0) {
        content += "\n[Table Data]\n";
        rows.forEach((row: any) => {
          const cells = row.querySelectorAll("th, td");
          if (cells.length > 0) {
            const rowData = Array.from(cells).map((cell: any) => {
              return (cell.textContent || '').trim();
            }).filter(cell => cell.length > 0);
            if (rowData.length > 0) {
              content += rowData.join(" | ") + "\n";
            }
          }
        });
        content += "\n";
      }
    });
    
    // Extract stat boxes and highlighted numbers
    const statBoxes = mainContent.querySelectorAll(".stat-box, .stat-number, [class*='stat'], [class*='number']");
    statBoxes.forEach((box: any) => {
      const text = (box.textContent as string | null)?.trim();
      if (text && text.length > 5) {
        content += text + "\n\n";
      }
    });
  }

  // Priority 2: If no main content found, use structured selectors
  if (!content.trim()) {
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
    ];

    contentSelectors.forEach((selector) => {
      const elements = clonedDoc.querySelectorAll(selector) as any;
      elements.forEach((el: any) => {
        // Skip if element is in nav/sidebar
        if (el.closest("nav, aside, .nav, .sidebar, .menu")) {
          return;
        }
        
        const text = (el.textContent as string | null)?.trim();
        if (text && text.length > 30) {
          content += text + "\n\n";
        }
      });
    });
  }

  // Priority 3: Fallback to body text (filtered)
  if (!content.trim()) {
    const body = (clonedDoc as any).body;
    if (body) {
      // Remove navigation and sidebar from body
      const navElements = body.querySelectorAll("nav, aside, .nav, .sidebar, .menu, header, footer");
      navElements.forEach((el: any) => (el as any).remove());
      
      // Extract paragraphs and headings
      const paragraphs = body.querySelectorAll("p, h1, h2, h3, h4, h5, h6");
      paragraphs.forEach((el: any) => {
        const text = (el.textContent as string | null)?.trim();
        if (text && text.length > 30) {
          content += text + "\n\n";
        }
      });
      
      // Extract tables from body as fallback
      const tables = body.querySelectorAll("table");
      tables.forEach((table: any) => {
        const rows = table.querySelectorAll("tr");
        if (rows.length > 0) {
          content += "\n[Table Data]\n";
          rows.forEach((row: any) => {
            const cells = row.querySelectorAll("th, td");
            if (cells.length > 0) {
              const rowData = Array.from(cells).map((cell: any) => {
                return (cell.textContent || '').trim();
              }).filter(cell => cell.length > 0);
              if (rowData.length > 0) {
                content += rowData.join(" | ") + "\n";
              }
            }
          });
          content += "\n";
        }
      });
    }
  }

  // Clean up whitespace and remove very short lines (likely navigation items)
  return content
    .split("\n")
    .filter(line => line.trim().length > 20) // Filter out short lines
    .join("\n")
    .replace(/\s+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .trim();
}

// Auto-extract content when page loads (for AI analysis)
// Only extract from actual web pages, not internal/UI pages
if (typeof window !== 'undefined') {
  let isExtracting = false;
  let lastExtractedUrl: string | null = null;
  
  const extractAndSendContent = async () => {
    const currentUrl = window.location.href;
    
    // Prevent duplicate extractions
    if (isExtracting) {
      console.log('[Preload] Extraction already in progress, skipping...');
      return;
    }
    
    // Prevent duplicate extractions for the same URL
    if (lastExtractedUrl === currentUrl) {
      console.log('[Preload] Content already extracted for this URL, skipping...');
      return;
    }
    
    isExtracting = true;
    try {
      const url = window.location.href.toLowerCase();
      
      // Skip internal/UI URLs - only process actual web pages
      // But allow file:// URLs for dev sample and test booking in development mode
      // Note: process.env may not be available in preload, so check for specific files
      const isDevSampleFile = url.includes('dev-sample.html');
      const isTestBookingFile = url.includes('test-booking.html');
      const isInternalUrl = 
        url.startsWith('http://localhost') ||
        url.startsWith('https://localhost') ||
        url.startsWith('http://127.0.0.1') ||
        url.startsWith('https://127.0.0.1') ||
        url.startsWith('about:') ||
        (url.startsWith('file://') && !isDevSampleFile && !isTestBookingFile) || // Allow dev sample and test booking files
        url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url === '' ||
        url === 'about:blank';
      
      if (isInternalUrl) {
        console.log(`[Preload] Skipping DOM extraction for internal URL: ${window.location.href}`);
        return;
      }
      
      console.log(`[Preload] Extracting DOM content for URL: ${window.location.href}`);
      const content = extractPageContent();
      const wordCount = content ? content.trim().split(/\s+/).length : 0;
      const tableCount = (content.match(/\[Table Data\]/g) || []).length;
      console.log(`[Preload] Extracted ${wordCount} words from page, found ${tableCount} table(s)`);
      
      // Only send if we have meaningful content (more than just a few words)
      if (!content || wordCount < 10) {
        console.log(`[Preload] Skipping DOM extraction - insufficient content (${wordCount} words, need at least 10)`);
        return;
      }
      
      const pageInfo = {
        url: window.location.href,
        title: document.title,
        selectedText: '' // Can't get selection in preload context
      };

      console.log(`[Preload] Sending DOM content to main process: ${wordCount} words, title: "${pageInfo.title}"`);
      // Send to main process for AI processing
      await ipcRenderer.invoke(IPCChannels.dom.content, {
        tabId: getCurrentTabId(), // TODO: Get actual tab ID
        content,
        htmlContent: document.documentElement.outerHTML, // Include HTML for structure extraction
        url: pageInfo.url,
        title: pageInfo.title,
      });
      console.log(`[Preload] DOM content sent successfully`);
      lastExtractedUrl = currentUrl;
    } catch (error) {
      console.error("Failed to extract DOM content:", error);
    } finally {
      isExtracting = false;
    }
  };
  
  // Try multiple events - file:// URLs might not fire 'load' event reliably
  window.addEventListener("load", extractAndSendContent);
  document.addEventListener("DOMContentLoaded", () => {
    console.log('[Preload] DOMContentLoaded event fired');
    // For file:// URLs, DOMContentLoaded might fire before load
    setTimeout(extractAndSendContent, 500);
  });
  
  // Fallback: if document is already ready, extract immediately
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    console.log('[Preload] Document already ready, extracting immediately');
    setTimeout(extractAndSendContent, 500);
  }
}

// Helper function to get current tab ID
function getCurrentTabId(): string {
  // Try to get tabId from window context (injected by main process)
  if (typeof window !== 'undefined' && (window as any).__TAB_ID__) {
    return (window as any).__TAB_ID__;
  }
  // Fallback to placeholder if not available
  return "current-tab";
}

// Handle keyboard shortcuts (only if document is available)
if (typeof document !== 'undefined') {
  document.addEventListener("keydown", (event: any) => {
    // Command palette shortcut
    if ((event.ctrlKey || event.metaKey) && event.key === "k") {
      event.preventDefault();
      ipcRenderer.send(IPCChannels.events.commandPaletteToggle);
    }

    // AI panel toggle
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === "A") {
      event.preventDefault();
      ipcRenderer.send(IPCChannels.events.aiTogglePanel);
    }

    // Zoom shortcuts (fallback if global shortcuts don't work)
    if ((event.ctrlKey || event.metaKey)) {
      if (event.key === "=" || event.key === "+") {
        console.log('Preload: Zoom in triggered, preventing default');
        event.preventDefault();
        ipcRenderer.send(IPCChannels.zoom.in);
      } else if (event.key === "-") {
        console.log('Preload: Zoom out triggered, preventing default');
        event.preventDefault();
        ipcRenderer.send(IPCChannels.zoom.out);
      } else if (event.key === "0") {
        console.log('Preload: Zoom reset triggered, preventing default');
        event.preventDefault();
        ipcRenderer.send(IPCChannels.zoom.reset);
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
