// Session Management IPC Handlers

import { ipcMain } from 'electron';
import { SessionManager } from '../../session/SessionManager';
import { IPCChannels, Tab } from '../../../shared/types';
import { getCachedContent } from '../../agent/rag/cache';

export function setupSessionHandlers(sessionManager: SessionManager): void {
  console.log('[SessionHandlers] Setting up session IPC handlers...');
  console.log('[SessionHandlers] Channel create:', IPCChannels.session.create);
  console.log('[SessionHandlers] Channel getAll:', IPCChannels.session.getAll);
  console.log('[SessionHandlers] Channel showView:', IPCChannels.session.showView);
  
  // Session creation
  ipcMain.handle(IPCChannels.session.create, async (event, request: { url?: string; initialMessage?: string }) => {
    console.log('[SessionHandlers] create handler called');
    const session = await sessionManager.createSession(request);
    const serialized = JSON.parse(JSON.stringify(session));
    return serialized;
  });

  // Get session
  ipcMain.handle(IPCChannels.session.get, async (event, sessionId: string) => {
    const session = sessionManager.getSession(sessionId);
    if (!session) return null;
    const serialized = JSON.parse(JSON.stringify(session));
    if ((serialized as any).tabId) {
      delete (serialized as any).tabId;
    }
    return serialized;
  });

  // Get all sessions
  const getAllChannel = IPCChannels.session.getAll;
  console.log('[SessionHandlers] Registering getAll handler on channel:', getAllChannel);
  ipcMain.handle(getAllChannel, async () => {
    console.log('[SessionHandlers] getAll handler called');
    const sessions = sessionManager.getAllSessions();
    return sessions.map(session => {
      const serialized = JSON.parse(JSON.stringify(session));
      if ((serialized as any).tabId) {
        delete (serialized as any).tabId;
      }
      return serialized;
    });
  });

  // Get session IDs
  ipcMain.handle(IPCChannels.session.getIds, async () => {
    const sessions = sessionManager.getAllSessions();
    return sessions.map(session => ({
      id: session.id,
      title: session.title,
      url: session.url,
      state: session.state,
      messageCount: session.messages.length,
    }));
  });

  // Delete session
  ipcMain.handle(IPCChannels.session.delete, async (event, sessionId: string) => {
    return sessionManager.deleteSession(sessionId);
  });

  // Get tab ID for session
  ipcMain.handle(IPCChannels.session.getTabId, async (event, sessionId: string) => {
    return sessionManager.getTabId(sessionId);
  });

  // Navigate session
  ipcMain.handle(IPCChannels.session.navigate, async (event, sessionId: string, url: string) => {
    const tabId = sessionManager.getTabId(sessionId);
    if (!tabId) {
      return { success: false, error: 'Session has no associated tab' };
    }
    const { getTabManager } = require('../index');
    const tabManager = getTabManager();
    if (tabManager) {
      const success = tabManager.navigate(tabId, url);
      return { success };
    }
    return { success: false };
  });

  // Show session view
  const showViewChannel = IPCChannels.session.showView;
  console.log('[SessionHandlers] Registering showView handler on channel:', showViewChannel);
  ipcMain.handle(showViewChannel, async (event, sessionId: string | null) => {
    console.log('[SessionHandlers] showView handler called with sessionId:', sessionId);
    
    const { getTabManager } = require('../index');
    const tabManager = getTabManager();
    if (!tabManager) {
      return { success: false, error: 'TabManager not available' };
    }

    if (sessionId === null) {
      // Hide all BrowserViews by moving them off-screen
      const allTabs = tabManager.getTabs();
      console.log('[SessionHandlers] Hiding all BrowserViews, tabs count:', allTabs.length);
      allTabs.forEach((tab: Tab) => {
        const view = tabManager.getBrowserView(tab.id);
        if (view) {
          // Move view off-screen to hide it
          view.setBounds({ x: -10000, y: -10000, width: 0, height: 0 });
        }
      });
      return { success: true };
    }

    // Show the BrowserView for this session
    const tabId = sessionManager.getTabId(sessionId);
    if (!tabId) {
      return { success: false, error: 'Session has no associated tab' };
    }

    // Hide all other views first
    const allTabs = tabManager.getTabs();
    allTabs.forEach((tab: Tab) => {
      if (tab.id !== tabId) {
        const view = tabManager.getBrowserView(tab.id);
        if (view) {
          view.setBounds({ x: -10000, y: -10000, width: 0, height: 0 });
        }
      }
    });

    // Show the target view (bounds will be set by React ResizeObserver)
    const targetView = tabManager.getBrowserView(tabId);
    if (targetView) {
      // Get mainWindow from TabManager - we need to access it
      // TabManager has mainWindow as a private property, so we'll use switchToTab
      // which handles showing the view properly
      tabManager.switchToTab(tabId);
      console.log('[SessionHandlers] Showing BrowserView for session:', sessionId, 'tab:', tabId);
    } else {
      console.warn('[SessionHandlers] BrowserView not found for tab:', tabId);
      return { success: false, error: 'BrowserView not found for session' };
    }

    return { success: true };
  });

  // Update session view bounds
  ipcMain.handle(IPCChannels.session.updateBounds, async (event, sessionId: string, bounds: { x: number; y: number; width: number; height: number }) => {
    const tabId = sessionManager.getTabId(sessionId);
    if (!tabId) {
      return { success: false };
    }
    const { getTabManager } = require('../index');
    const tabManager = getTabManager();
    if (tabManager) {
      const view = tabManager.getBrowserView(tabId);
      if (view) {
        view.setBounds(bounds);
        return { success: true };
      }
    }
    return { success: false };
  });

  // Get chunks for a session
  ipcMain.handle(IPCChannels.session.getChunks, async (event, sessionId: string) => {
    const tabId = sessionManager.getTabId(sessionId);
    if (!tabId) {
      return { success: false, error: 'Session not found', chunks: null };
    }

    const cache = getCachedContent(tabId);
    if (!cache) {
      return { success: false, error: 'No cached content for this session', chunks: null };
    }

    // Return chunks with components
    return {
      success: true,
      chunks: cache.chunks,
      components: cache.components,
      pageContent: cache.pageContent,
    };
  });
}

