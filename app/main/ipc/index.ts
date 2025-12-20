// IPC Setup and Management

import { BrowserWindow, ipcMain } from 'electron';
import { TabManager } from '../tabs';
import { SessionManager } from '../session/SessionManager';
import { IPCChannels, IPCChannel } from '../../shared/types';
import { setupTabHandlers } from './handlers/tab-handlers';
import { setupSessionHandlers } from './handlers/session-handlers';
import { setupAgentHandlers } from './handlers/agent-handlers';
import { setupDOMHandlers } from './handlers/dom-handlers';
import { setupMiscHandlers } from './handlers/misc-handlers';

let tabManager: TabManager | null = null;
let sessionManager: SessionManager | null = null;

// Export getters for accessing managers
export function getTabManager(): TabManager | null {
  return tabManager;
}

export function getSessionManager(): SessionManager | null {
  return sessionManager;
}

export function setupIPC(mainWindow: BrowserWindow) {
  console.log('[IPC] Setting up IPC handlers...');
  
  // Initialize managers
  tabManager = new TabManager(mainWindow);
  sessionManager = new SessionManager(mainWindow, tabManager);
  console.log('[IPC] TabManager and SessionManager created');

  // Set up all IPC handlers
  console.log('[IPC] Registering IPC handlers...');
  setupTabHandlers(tabManager);
  setupSessionHandlers(sessionManager);
  setupAgentHandlers(sessionManager);
  setupDOMHandlers(tabManager);
  setupMiscHandlers(mainWindow);
  
  // Verify handlers are registered
  const registeredHandlers = (ipcMain as any)._handlers || {};
  console.log('[IPC] Registered handlers count:', Object.keys(registeredHandlers).length);
  console.log('[IPC] Checking session handlers:');
  console.log('  - session:create:', !!registeredHandlers[IPCChannels.session.create]);
  console.log('  - session:get-all:', !!registeredHandlers[IPCChannels.session.getAll]);
  console.log('  - session:show-view:', !!registeredHandlers[IPCChannels.session.showView]);
  console.log('[IPC] All IPC handlers registered successfully');

  // Handle window resize
  mainWindow.on('resize', () => {
    const [width, height] = mainWindow.getSize();
    tabManager!.onWindowResize(width, height);
  });

  // Security: Validate IPC channels
  const allowedChannels = new Set<string>();
  // Add all channels from IPCChannels object
  Object.values(IPCChannels).forEach(category => {
    if (typeof category === 'object') {
      Object.values(category).forEach(channel => {
        if (typeof channel === 'string') {
          allowedChannels.add(channel);
        }
      });
    }
  });

  ipcMain.on('validate-channel', (event, channel: string) => {
    event.returnValue = allowedChannels.has(channel);
  });

  // Handle app-level events from renderer
  ipcMain.on(IPCChannels.events.appEvent, (event, eventType: string, data: any) => {
    switch (eventType) {
      case 'tab-created':
      case 'tab-closed':
      case 'navigation':
        // Log app events
        break;
      default:
        console.log('Unknown app event:', eventType, data);
    }
  });

  // Extract handleCreateSession for CLI
  async function handleCreateSession(event: any, request: { url?: string; initialMessage?: string }) {
    if (!sessionManager) {
      throw new Error('SessionManager not initialized');
    }
    const session = await sessionManager.createSession(request);
    const serialized = JSON.parse(JSON.stringify(session));
    return serialized;
  }

  return {
    tabManager,
    sessionManager,
    handleCreateSession,
  };
}

export function cleanupIPC(): void {
  // Cleanup if needed
  tabManager = null;
  sessionManager = null;
}

