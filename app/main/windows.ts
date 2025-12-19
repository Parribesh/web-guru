import { BrowserWindow, BrowserView } from 'electron';
import * as path from 'path';
import { Tab } from '../shared/types';
import { eventLogger } from './logging/event-logger';

export function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, '../../preload/preload/index.js'),
    },
    show: false, // Don't show until ready
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    icon: path.join(__dirname, '../../assets/icon.png'), // TODO: Add app icon
  });

  // Load the renderer process
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    // Detach devtools so BrowserView doesn't cover the docked console
    // TEMPORARY: Enable DevTools for debugging
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle window events
  mainWindow.on('closed', () => {
    // Clean up any BrowserViews
    const views = mainWindow.getBrowserViews();
    views.forEach(view => mainWindow.removeBrowserView(view));
  });

  return mainWindow;
}

// Utility function to completely clear Electron session data
function clearAllSessionData(session: Electron.Session) {
  console.log('🧹 Starting complete session cleanup...');

  // Clear all storage types
  session.clearStorageData({
    storages: [
      'cookies', 'filesystem', 'indexdb',
      'localstorage', 'shadercache', 'websql',
      'serviceworkers', 'cachestorage'
    ]
  });

  // Clear caches (may not work in all Electron versions)
  try {
    session.clearCache();
    console.log('✅ Cache cleared');
  } catch (error: any) {
    console.log('⚠️ Cache clear failed:', error?.message || 'Unknown error');
  }

  try {
    session.clearHostResolverCache();
    console.log('✅ Host resolver cache cleared');
  } catch (error: any) {
    console.log('⚠️ Host resolver cache clear failed:', error?.message || 'Unknown error');
  }

  // Flush any pending data
  session.flushStorageData();
  console.log('🎯 Session cleanup complete');
}

export async function createBrowserView(tab: Tab, preloadPath: string, mainWindow?: BrowserWindow): Promise<BrowserView> {
  console.log(`🔍 Creating BrowserView for tab ${tab.id} with partition: tab-${tab.id}-${Date.now()}`);

  const view = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      partition: undefined, // In-memory only, no persistence
      preload: preloadPath,
      sandbox: false, // Allow preload to access node for IPC glue
    }
  });

  console.log(`📊 BrowserView created with session:`, view.webContents.session.getStoragePath());
  console.log(`🔒 Session persistence: ${view.webContents.session.isPersistent() ? 'PERSISTENT' : 'IN-MEMORY'}`);

  // Check initial zoom before any resets
  const initialZoom = view.webContents.getZoomFactor();
  console.log(`🔍 Initial zoom factor: ${initialZoom}`);

  // Completely clear ALL session data to prevent zoom persistence
  const session = view.webContents.session;
  clearAllSessionData(session);

  // Set initial bounds (will be updated after adding to window)
  view.setBounds({ x: 0, y: 80, width: 1200, height: 720 }); // Default bounds, will be updated
  view.setBackgroundColor('#ffffff');

  // Reset zoom to default (multiple times to ensure it sticks)
  console.log('⚡ Setting initial zoom to 1.0');
  view.webContents.setZoomFactor(1.0);
  console.log(`✅ Initial zoom set to: ${view.webContents.getZoomFactor()}`);

  // Also reset after delay (override session restoration)
  setTimeout(() => {
    const beforeReset = view.webContents.getZoomFactor();
    view.webContents.setZoomFactor(1.0);
    const afterReset = view.webContents.getZoomFactor();
    console.log(`🔄 Delayed zoom reset: ${beforeReset} → ${afterReset}`);
  }, 100);

  // Reset zoom when content loads (most important!)
  view.webContents.on('did-finish-load', () => {
    console.log('📄 Content finished loading, resetting zoom');
    const url = view.webContents.getURL();
    console.log('📄 did-finish-load URL:', url);
    
    setTimeout(() => {
      const beforeReset = view.webContents.getZoomFactor();
      view.webContents.setZoomFactor(1.0);
      const afterReset = view.webContents.getZoomFactor();
      console.log(`🎯 Content-load zoom reset: ${beforeReset} → ${afterReset}`);
      view.webContents.invalidate(); // Force visual refresh
      
      // Also update tab state on did-finish-load (backup to did-stop-loading)
      if (mainWindow && !mainWindow.isDestroyed() && tab && tab.id) {
        const title = view.webContents.getTitle();
        if (url && url !== 'about:blank') {
          const update = {
            id: tab.id,
            url: url || tab.url || '',
            title: title || tab.title || 'Untitled',
            isLoading: false,
            canGoBack: view.webContents.canGoBack(),
            canGoForward: view.webContents.canGoForward(),
            favicon: tab.favicon,
          };
          mainWindow.webContents.send('tab:update', update);
          console.log('📤 Sent tab:update (did-finish-load) to main window:', update.id);
        }
      }
    }, 100);
  });

  // Debug: Check if any navigation events fire
  view.webContents.on('did-start-loading', () => {
    console.log('⏳ Started loading:', view.webContents.getURL());
    // Update tab to show loading state
    view.webContents.send('tab:update', {
      ...tab,
      isLoading: true,
      url: view.webContents.getURL(),
    });
  });

  // Debug: Periodically check zoom factor
  const zoomCheckInterval = setInterval(() => {
    const currentZoom = view.webContents.getZoomFactor();
    if (currentZoom !== 1.0) {
      console.log(`🚨 ZOOM ANOMALY: Zoom is ${currentZoom} (should be 1.0)`);
    }
  }, 1000);

  // Clear interval when view is destroyed
  view.webContents.on('destroyed', () => {
    clearInterval(zoomCheckInterval);
  });

  // Also on DOM ready - this fires for file:// URLs
  view.webContents.on('dom-ready', () => {
    console.log('📄 DOM ready for:', view.webContents.getURL());
    setTimeout(() => {
      const beforeReset = view.webContents.getZoomFactor();
      view.webContents.setZoomFactor(1.0);
      const afterReset = view.webContents.getZoomFactor();
      console.log(`🎯 DOM-ready zoom reset: ${beforeReset} → ${afterReset}`);
      
      // For file:// URLs, dom-ready might be the only event that fires reliably
      // So update tab state here as well
      if (mainWindow && !mainWindow.isDestroyed() && tab && tab.id) {
        const url = view.webContents.getURL();
        const title = view.webContents.getTitle();
        
        // Only update if it's a real URL (not about:blank)
        if (url && url !== 'about:blank') {
          const update = {
            id: tab.id,
            url: url || tab.url || '',
            title: title || tab.title || 'Untitled',
            isLoading: false, // DOM is ready, so page is loaded
            canGoBack: view.webContents.canGoBack(),
            canGoForward: view.webContents.canGoForward(),
            favicon: tab.favicon,
          };
          mainWindow.webContents.send('tab:update', update);
          console.log('📤 Sent tab:update (dom-ready) to main window:', update.id, 'isLoading:', update.isLoading);
        }
      }
    }, 100); // Small delay to ensure everything is ready
  });

  // Disable browser zoom shortcuts to prevent conflicts
  view.webContents.on('before-input-event', (event, input) => {
    if (input.control && (input.key === '+' || input.key === '=' || input.key === '-')) {
      event.preventDefault();
    }
  });

  // Inject tabId into the BrowserView context for preload script
  view.webContents.once('dom-ready', () => {
    view.webContents.executeJavaScript(`
      if (typeof window !== 'undefined') {
        window.__TAB_ID__ = '${tab.id}';
      }
    `).catch(err => console.error('Failed to inject tabId:', err));
  });

  // Load initial URL
  if (tab.url) {
    console.log(`🌐 Loading URL: ${tab.url}`);
    view.webContents.loadURL(tab.url);
  } else {
    // Start blank; React chrome owns the UI
    console.log(`🌐 Loading about:blank`);
    view.webContents.loadURL('about:blank');
  }

  // Debug: Check what URL is actually loaded
  setTimeout(() => {
    const currentURL = view.webContents.getURL();
    console.log(`🔗 Current URL after load: ${currentURL}`);
  }, 500);

  // Monitor zoom changes (don't force to 1.0 after content loads)
  view.webContents.on('zoom-changed', (event, zoomDirection) => {
    const currentZoom = view.webContents.getZoomFactor();
    console.log(`📢 Zoom-changed event: direction=${zoomDirection}, current=${currentZoom}`);

    // DEBUG: Don't force zoom, just log what's happening
    console.log(`🔍 Zoom changed to ${currentZoom} - NOT forcing back to 1.0`);
  });

  // Handle page loading events
  view.webContents.on('did-start-loading', () => {
    // Notify main window's renderer of loading state
    if (mainWindow && !mainWindow.isDestroyed() && tab && tab.id) {
      const update = {
        id: tab.id,
        url: view.webContents.getURL() || tab.url || '',
        title: tab.title || 'Loading...',
        isLoading: true,
        canGoBack: view.webContents.canGoBack(),
        canGoForward: view.webContents.canGoForward(),
        favicon: tab.favicon,
      };
      mainWindow.webContents.send('tab:update', update);
      console.log('📤 Sent tab:update (loading) to main window:', update.id);
    }
  });

  view.webContents.on('did-stop-loading', () => {
    // Update tab info and notify main window's renderer
    const title = view.webContents.getTitle();
    const url = view.webContents.getURL();
    
    console.log('✅ Stopped loading:', url, 'Title:', title);

    // Log that article/page was fetched successfully (include file:// URLs)
    if (url && url !== 'about:blank' && 
        !url.startsWith('http://localhost') && 
        !url.startsWith('http://127.0.0.1')) {
      eventLogger.success('Navigation', `Article fetched: ${title || 'Untitled'}`);
      eventLogger.info('Navigation', `URL: ${url}`);
    }

    // Send to main window's renderer, not BrowserView's renderer
    if (mainWindow && !mainWindow.isDestroyed() && tab && tab.id) {
      const update = {
        id: tab.id,
        url: url || tab.url || '',
        title: title || tab.title || 'Untitled',
        isLoading: false,
        canGoBack: view.webContents.canGoBack(),
        canGoForward: view.webContents.canGoForward(),
        favicon: tab.favicon,
      };
      mainWindow.webContents.send('tab:update', update);
      console.log('📤 Sent tab:update (loaded) to main window:', update.id, 'isLoading:', update.isLoading);
    } else {
      console.warn('⚠️ Cannot send tab:update - missing mainWindow or tab:', { 
        hasMainWindow: !!mainWindow, 
        isDestroyed: mainWindow?.isDestroyed(), 
        hasTab: !!tab, 
        tabId: tab?.id 
      });
    }
  });

  view.webContents.on('page-favicon-updated', (event, favicons) => {
    // Update favicon if available
    if (favicons.length > 0) {
      view.webContents.send('tab:update', {
        ...tab,
        favicon: favicons[0]
      });
    }
  });

  // Security: Prevent new windows
  view.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  return view;
}

export function updateBrowserViewBounds(view: BrowserView, bounds: Electron.Rectangle) {
  view.setBounds(bounds);
}

export function setBrowserViewBounds(view: BrowserView, window: BrowserWindow) {
  const { width, height } = window.getContentBounds();
  const topOffset = 80; // Space for UI (tab bar + address bar)
  const availableHeight = Math.max(0, height - topOffset);
  const viewportWidth = Math.max(0, Math.floor(width * 0.5)); // Left half for page

  view.setBounds({
    x: 0,
    y: topOffset,
    width: viewportWidth,
    height: availableHeight
  });
}

export function destroyBrowserView(view: BrowserView) {
  // Clean up resources
  // Note: BrowserView cleanup is handled by Electron when removing from window
}
