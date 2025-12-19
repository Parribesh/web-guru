import { ipcMain, BrowserWindow, dialog } from 'electron';
import { TabManager } from './tabs';
import { processAIRequest } from './ai';
import { cachePageContent } from './rag/qa-service';
import { eventLogger } from './logging/event-logger';
import {
  IPCChannels,
  AIRequest,
  IPCMessage,
  Tab,
  QARequest
} from '../shared/types';

let tabManager: TabManager | null = null;

export function setupIPC(mainWindow: BrowserWindow) {
  console.log('Setting up IPC handlers');
  tabManager = new TabManager(mainWindow);
  console.log('TabManager created, registering IPC handlers');

  // Tab management
  ipcMain.handle(IPCChannels.CREATE_TAB, async (event, url?: string) => {
    const tabId = tabManager!.createTab(url);
    const tabs = tabManager!.getTabs();
    return { tabId, tabs };
  });

  ipcMain.handle(IPCChannels.CLOSE_TAB, async (event, tabId: string) => {
    const success = await tabManager!.closeTab(tabId);
    const tabs = tabManager!.getTabs();
    const activeTabId = tabManager!.getActiveTabId();
    return { success, tabs, activeTabId };
  });

  ipcMain.handle(IPCChannels.SWITCH_TAB, async (event, tabId: string) => {
    const success = tabManager!.switchToTab(tabId);
    return { success };
  });

  // Navigation
  ipcMain.handle(IPCChannels.NAVIGATE, async (event, tabId: string, url: string) => {
    const success = tabManager!.navigate(tabId, url);
    return { success };
  });

  ipcMain.handle(IPCChannels.GO_BACK, async (event, tabId: string) => {
    const success = tabManager!.goBack(tabId);
    return { success };
  });

  ipcMain.handle(IPCChannels.GO_FORWARD, async (event, tabId: string) => {
    const success = tabManager!.goForward(tabId);
    return { success };
  });

  ipcMain.handle(IPCChannels.RELOAD, async (event, tabId: string) => {
    const success = tabManager!.reload(tabId);
    return { success };
  });

  ipcMain.handle(IPCChannels.STOP_LOADING, async (event, tabId: string) => {
    const success = tabManager!.stopLoading(tabId);
    return { success };
  });

  // AI services
  ipcMain.handle(IPCChannels.AI_REQUEST, async (event, request: AIRequest) => {
    try {
      const response = await processAIRequest(request);
      return response;
    } catch (error) {
      console.error('AI request error:', error);
      return {
        success: false,
        content: '',
        error: 'AI service unavailable'
      };
    }
  });

  // DOM content extraction (from preload)
  ipcMain.handle(IPCChannels.DOM_CONTENT, async (event, data: { 
    tabId: string; 
    content: string; 
    htmlContent?: string;
    url: string; 
    title: string 
  }) => {
    // Get the actual tabId by looking up which BrowserView sent this message
    let actualTabId = data.tabId;
    if (data.tabId === 'current-tab' || !data.tabId) {
      // Find the tabId by matching the webContents that sent this message
      const senderWebContentsId = event.sender.id;
      const resolvedTabId = tabManager!.getTabIdByWebContents(senderWebContentsId);
      
      if (resolvedTabId) {
        actualTabId = resolvedTabId;
        eventLogger.debug('IPC', `Resolved tabId from "${data.tabId}" to "${actualTabId}" for URL: ${data.url}`);
      } else {
        eventLogger.warning('IPC', `Could not resolve tabId for DOM_CONTENT from URL: ${data.url}. Using provided tabId: ${data.tabId}`);
      }
    }
    
    console.log(`DOM_CONTENT IPC handler called for tab ${actualTabId}: ${data.title}`);
    eventLogger.info('QA Service', `Received page content for tab ${actualTabId}: ${data.title}`);
    
    // Filter out internal/UI URLs - only embed actual web pages
    // But allow file:// URLs in development for testing
    const url = data.url.toLowerCase();
    const isDev = process.env.NODE_ENV === 'development';
    const isDevSampleFile = isDev && url.includes('dev-sample.html');
    const isInternalUrl = 
      url.startsWith('http://localhost') ||
      url.startsWith('https://localhost') ||
      url.startsWith('http://127.0.0.1') ||
      url.startsWith('https://127.0.0.1') ||
      url.startsWith('about:') ||
      (url.startsWith('file://') && !isDevSampleFile) || // Allow dev sample file
      url.startsWith('chrome://') ||
      url.startsWith('chrome-extension://') ||
      url === '' ||
      url === 'about:blank';
    
    if (isInternalUrl) {
      console.log(`⏭️ Skipping embedding for internal URL: ${data.url}`);
      eventLogger.info('QA Service', `Skipping internal URL: ${data.url}`);
      return { success: true, skipped: true };
    }
    
    // Cache page content for QA system
    try {
      await cachePageContent(
        actualTabId,
        data.content,
        data.htmlContent || '',
        data.url,
        data.title
      );
      console.log(`✅ Cached page content for tab ${actualTabId}`);
      eventLogger.success('QA Service', `Successfully cached page content for tab ${actualTabId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Failed to cache page content for tab ${actualTabId}:`, error);
      eventLogger.error('QA Service', `Failed to cache page content for tab ${actualTabId}`, errorMessage);
    }
    
    return { success: true };
  });

  // QA request handler
  ipcMain.handle('qa:ask', async (event, request: QARequest) => {
    console.log(`QA request for tab ${request.tabId}: ${request.question}`);
    const { answerQuestion } = require('./rag/qa-service');
    return await answerQuestion(request);
  });

  // Logging handlers
  ipcMain.handle('log:get-events', () => {
    const { eventLogger } = require('./logging/event-logger');
    return eventLogger.getEvents();
  });

  ipcMain.handle('log:clear', () => {
    const { eventLogger } = require('./logging/event-logger');
    eventLogger.clear();
    return { success: true };
  });

  // Window management
  ipcMain.handle(IPCChannels.WINDOW_MINIMIZE, async () => {
    mainWindow.minimize();
  });

  ipcMain.handle(IPCChannels.WINDOW_MAXIMIZE, async () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.handle(IPCChannels.WINDOW_CLOSE, async () => {
    mainWindow.close();
  });

  // Dev tools
  ipcMain.handle(IPCChannels.OPEN_DEV_TOOLS, async (event, tabId?: string) => {
    if (tabId) {
      // Open dev tools for specific tab
      const tabs = tabManager!.getTabs();
      const tab = tabs.find(t => t.id === tabId);
      if (tab) {
        // TODO: Implement per-tab dev tools
        console.log(`Opening dev tools for tab: ${tabId}`);
      }
    } else {
      // Open main window dev tools
      mainWindow.webContents.openDevTools();
    }
  });

  // Handle renderer requests for current state
  ipcMain.handle('get-tabs', async () => {
    console.log('get-tabs IPC handler called');
    return {
      tabs: tabManager!.getTabs(),
      activeTabId: tabManager!.getActiveTabId()
    };
  });

  // Handle window resize
  mainWindow.on('resize', () => {
    const [width, height] = mainWindow.getSize();
    tabManager!.onWindowResize(width, height);
  });

  // Security: Validate IPC channels
  const allowedChannels = new Set(Object.values(IPCChannels));

  ipcMain.on('validate-channel', (event, channel: string) => {
    event.returnValue = allowedChannels.has(channel as IPCChannels);
  });

  // Handle zoom commands from preload script
  ipcMain.on('zoom-in', () => {
    console.log('Zoom in from preload');
    tabManager?.zoomActiveTab(0.1);
  });

  ipcMain.on('zoom-out', () => {
    console.log('Zoom out from preload');
    tabManager?.zoomActiveTab(-0.1);
  });

  ipcMain.on('zoom-reset', () => {
    console.log('Zoom reset from preload');
    tabManager?.resetZoomActiveTab();
  });

  // Handle app-level events from renderer
  ipcMain.on('app-event', (event, eventType: string, data: any) => {
    switch (eventType) {
      case 'tab-created':
        console.log('Tab created:', data);
        break;
      case 'tab-closed':
        console.log('Tab closed:', data);
        break;
      case 'navigation':
        console.log('Navigation:', data);
        break;
      default:
        console.log('Unknown app event:', eventType, data);
    }
  });

  return tabManager;
}

// Clean up function
export function cleanupIPC() {
  ipcMain.removeAllListeners();
}
