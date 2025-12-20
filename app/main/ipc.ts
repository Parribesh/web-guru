import { ipcMain, BrowserWindow, dialog } from 'electron';
import { TabManager } from './tabs';
import { processAIRequest } from './ai';
import { cachePageContent } from './rag/qa-service';
import { eventLogger } from './logging/event-logger';
import { AgentManager } from './agent/AgentManager';
import { MessageRole, AgentState } from './agent/types';
import {
  IPCChannels,
  AIRequest,
  IPCMessage,
  Tab,
  QARequest
} from '../shared/types';

let tabManager: TabManager | null = null;
let agentManager: AgentManager | null = null;

// Export getters for accessing managers (for use in other modules)
export function getTabManager(): TabManager | null {
  return tabManager;
}

export function getAgentManager(): AgentManager | null {
  return agentManager;
}

export function setupIPC(mainWindow: BrowserWindow) {
  console.log('Setting up IPC handlers');
  tabManager = new TabManager(mainWindow);
  agentManager = new AgentManager(mainWindow, tabManager);
  console.log('TabManager and AgentManager created, registering IPC handlers');
  
  // Export handleCreateSession for use by terminal commands
  // This will be returned at the end of the function

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

  // Agent Session Management
  // Extract handler logic to a reusable function (can be called from IPC or terminal)
  async function handleCreateSession(event: any, request: { url?: string; initialMessage?: string }) {
    if (!agentManager) {
      throw new Error('AgentManager not initialized');
    }
    const session = await agentManager.createSession(request);
    // Return serialized version (AgentManager already sends events)
    // But we need to return a clean copy for the immediate response
    const serialized = JSON.parse(JSON.stringify(session));
    return serialized;
  }

  ipcMain.handle('agent:create-session', handleCreateSession);

  ipcMain.handle('agent:get-session', async (event, sessionId: string) => {
    if (!agentManager) {
      throw new Error('AgentManager not initialized');
    }
    const session = agentManager.getSession(sessionId);
    if (!session) return null;
    // Return serialized version
    const serialized = JSON.parse(JSON.stringify(session));
    if ((serialized as any).tabId) {
      delete (serialized as any).tabId;
    }
    return serialized;
  });

  ipcMain.handle('agent:get-all-sessions', async () => {
    if (!agentManager) {
      throw new Error('AgentManager not initialized');
    }
    const sessions = agentManager.getAllSessions();
    // Return serialized versions
    return sessions.map(session => {
      const serialized = JSON.parse(JSON.stringify(session));
      if ((serialized as any).tabId) {
        delete (serialized as any).tabId;
      }
      return serialized;
    });
  });

  // Get all session IDs (lightweight endpoint for CLI usage)
  ipcMain.handle('agent:get-session-ids', async () => {
    if (!agentManager) {
      throw new Error('AgentManager not initialized');
    }
    const sessions = agentManager.getAllSessions();
    return sessions.map(session => ({
      id: session.id,
      title: session.title,
      url: session.url,
      state: session.state,
      messageCount: session.messages.length
    }));
  });

  ipcMain.handle('agent:send-message', async (event, sessionId: string, content: string) => {
    if (!agentManager) {
      throw new Error('AgentManager not initialized');
    }
    // Get tabId for this session
    const tabId = agentManager.getTabId(sessionId);
    if (!tabId) {
      throw new Error(`Session ${sessionId} has no associated tab`);
    }
    
    // Use the RAG/QA system to process the message
    const qaRequest: QARequest = {
      question: content,
      tabId: tabId,
      context: {
        url: agentManager.getSession(sessionId)?.url || '',
        title: agentManager.getSession(sessionId)?.title || ''
      }
    };
    
    try {
      // Import QA service
      const { answerQuestion } = await import('./rag/qa-service');
      const qaResponse = await answerQuestion(qaRequest);
      
      // Update session with response
      const sessionManager = (agentManager as any).sessions.get(sessionId);
      if (sessionManager) {
        // Add user message
        sessionManager.addMessage(MessageRole.USER, content);
        sessionManager.updateState(AgentState.THINKING);
        agentManager.broadcastSessionUpdate(sessionManager.getSession()!);
        
        // Add AI response
        if (qaResponse.success) {
          sessionManager.addMessage(MessageRole.ASSISTANT, qaResponse.answer);
          // Store additional data in message metadata
          const session = sessionManager.getSession()!;
          const lastMessage = session.messages[session.messages.length - 1];
          if (lastMessage) {
            (lastMessage as any).data = {
              relevantChunks: qaResponse.relevantChunks,
              sourceLocation: qaResponse.sourceLocation,
              prompt: qaResponse.prompt
            };
          }
        } else {
          sessionManager.addMessage(MessageRole.ASSISTANT, qaResponse.error || 'Failed to get response');
        }
        sessionManager.updateState(AgentState.IDLE);
        agentManager.broadcastSessionUpdate(sessionManager.getSession()!);
      }
      
      return { success: true };
    } catch (error: any) {
      console.error('Error processing message with RAG:', error);
      // Fallback to placeholder
      agentManager.sendMessage(sessionId, content);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('agent:get-tab-id', async (event, sessionId: string) => {
    if (!agentManager) {
      throw new Error('AgentManager not initialized');
    }
    return agentManager.getTabId(sessionId);
  });

  ipcMain.handle('agent:delete-session', async (event, sessionId: string) => {
    if (!agentManager) {
      throw new Error('AgentManager not initialized');
    }
    return agentManager.deleteSession(sessionId);
  });

  // Session navigation - navigate the BrowserView for a session
  ipcMain.handle('agent:session-navigate', async (event, sessionId: string, url: string) => {
    if (!agentManager) {
      throw new Error('AgentManager not initialized');
    }
    const session = agentManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    // Get tabId from AgentManager's mapping
    const tabId = agentManager.getTabId(sessionId);
    if (!tabId) {
      throw new Error(`Session ${sessionId} has no associated tab`);
    }
    
    // Navigate the tab
    const success = tabManager!.navigate(tabId, url);
    if (success) {
      // Update session URL
      const sessionManager = (agentManager as any).sessions.get(sessionId);
      if (sessionManager) {
        sessionManager.updateUrl(url);
        agentManager.broadcastSessionUpdate(sessionManager.getSession()!);
      }
    }
    
    return { success };
  });

  // Show/hide BrowserView for a session
  ipcMain.handle('agent:session-show-view', async (event, sessionId: string | null) => {
    if (!agentManager || !tabManager) {
      return { success: false };
    }

    // Hide all BrowserViews first
    const allTabs = tabManager.getTabs();
    for (const tab of allTabs) {
      const view = (tabManager as any).views.get(tab.id);
      if (view) {
        // Hide by moving off-screen
        view.setBounds({ x: -10000, y: -10000, width: 0, height: 0 });
      }
    }

    // If a session is selected, show its BrowserView
    if (sessionId) {
      const session = agentManager.getSession(sessionId);
      if (session && tabManager) {
        const tabId = agentManager.getTabId(sessionId);
        if (tabId) {
          // Show the BrowserView for this session
          const success = tabManager.switchToTab(tabId);
          
          // Initial bounds will be set by React's ResizeObserver
          // But set a default position first
          const view = (tabManager as any).views.get(tabId);
          if (view) {
            // Set initial bounds (will be updated by React)
            const { width, height } = mainWindow.getContentBounds();
            const headerHeight = 60;
            const addressBarHeight = 48;
            view.setBounds({
              x: 0,
              y: headerHeight + addressBarHeight,
              width: Math.floor(width * 0.5),
              height: height - headerHeight - addressBarHeight,
            });
          }
          
          // If session has a URL, navigate to it
          if (session.url && session.url !== 'about:blank' && session.url !== '') {
            // Small delay to ensure view is ready
            setTimeout(() => {
              if (tabManager) {
                tabManager.navigate(tabId, session.url);
              }
            }, 100);
          }
          
          return { success };
        }
      }
    }

    return { success: true };
  });

  // Update BrowserView bounds based on React div position/size
  ipcMain.handle('agent:session-update-bounds', async (event, sessionId: string, bounds: { x: number; y: number; width: number; height: number }) => {
    if (!agentManager || !tabManager) {
      return { success: false };
    }

    const tabId = agentManager.getTabId(sessionId);
    if (!tabId) {
      return { success: false };
    }

    const view = (tabManager as any).views.get(tabId);
    if (view) {
      // Update BrowserView bounds to match React div
      view.setBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      });
      return { success: true };
    }

    return { success: false };
  });

  // Note: handleCreateSession is exported above for terminal command use
  // Export handleCreateSession for use by terminal commands
  return { tabManager, agentManager, handleCreateSession };
}

// Clean up function
export function cleanupIPC() {
  ipcMain.removeAllListeners();
}
