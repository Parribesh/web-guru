import { BrowserWindow, BrowserView } from 'electron';
import * as path from 'path';
import { Tab } from '../shared/types';

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

export function createBrowserView(tab: Tab, preloadPath: string): BrowserView {
  const view = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      partition: `persist:${tab.id}`, // Isolated session per tab
      preload: preloadPath,
        sandbox: false, // Allow preload to access node for IPC glue
    }
  });

  // Set bounds (will be updated by renderer)
  const { width, height } = view.webContents.getOwnerBrowserWindow().getContentBounds();
  const viewportWidth = Math.max(0, Math.floor(width * 0.5));
  const topOffset = 40;
  const availableHeight = Math.max(0, height - topOffset);
  view.setBounds({ x: 0, y: topOffset, width: viewportWidth, height: availableHeight }); // Left half for page
  view.setBackgroundColor('#000000');

  // Load initial URL
  if (tab.url) {
    view.webContents.loadURL(tab.url);
  } else {
    // Start blank; React chrome owns the UI
    view.webContents.loadURL('about:blank');
  }

  // Handle page loading events
  view.webContents.on('did-start-loading', () => {
    // Notify renderer of loading state
    view.webContents.send('tab:update', {
      ...tab,
      isLoading: true
    });
  });

  view.webContents.on('did-stop-loading', () => {
    // Update tab info and notify renderer
    const title = view.webContents.getTitle();
    const url = view.webContents.getURL();

    view.webContents.send('tab:update', {
      ...tab,
      title,
      url,
      isLoading: false,
      canGoBack: view.webContents.canGoBack(),
      canGoForward: view.webContents.canGoForward(),
    });
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

export function destroyBrowserView(view: BrowserView) {
  // Clean up resources
  // Note: BrowserView cleanup is handled by Electron when removing from window
}
