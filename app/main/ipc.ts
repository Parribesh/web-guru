import { ipcMain, BrowserWindow, dialog } from 'electron';
import { TabManager } from './tabs';
import { processAIRequest } from './ai';
import {
  IPCChannels,
  AIRequest,
  IPCMessage,
  Tab
} from '../shared/types';

let tabManager: TabManager | null = null;

export function setupIPC(mainWindow: BrowserWindow) {
  tabManager = new TabManager(mainWindow);

  // Tab management
  ipcMain.handle(IPCChannels.CREATE_TAB, async (event, url?: string) => {
    const tabId = tabManager!.createTab(url);
    const tabs = tabManager!.getTabs();
    return { tabId, tabs };
  });

  ipcMain.handle(IPCChannels.CLOSE_TAB, async (event, tabId: string) => {
    const success = tabManager!.closeTab(tabId);
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
  ipcMain.handle(IPCChannels.DOM_CONTENT, async (event, data: { tabId: string; content: string; url: string; title: string }) => {
    // Store or process DOM content for AI analysis
    // TODO: Implement content storage/caching
    console.log(`Received DOM content for tab ${data.tabId}: ${data.title}`);
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
}

// Clean up function
export function cleanupIPC() {
  ipcMain.removeAllListeners();
}
