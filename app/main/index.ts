// Main Process Entry Point

import { app, BrowserWindow } from 'electron';
import { setupIPC, getTabManager, getSessionManager } from './ipc';
import { WindowService } from './windows/WindowService';
import { eventLogger } from './logging/event-logger';
import { setupApplicationMenu } from './menu';
import { setupGlobalShortcuts, unregisterGlobalShortcuts } from './shortcuts';
import { setMainWindow } from './zoom';
import { setupCLIServer } from './cli/server';
import { preventMultipleInstances, setupSecurityHandlers } from './security';

let mainWindow: BrowserWindow | null = null;

// Security: Prevent multiple instances
if (!preventMultipleInstances(() => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
})) {
  // App will quit if lock failed
}

// Set up security handlers
setupSecurityHandlers();

app.on('ready', async () => {
  // Set up application menu
  mainWindow = WindowService.createMainWindow();
  setupApplicationMenu(mainWindow);

  // Set up event logger
  eventLogger.setMainWindow(mainWindow);
  eventLogger.info('App', 'Application starting...');

  // Set zoom manager's main window reference
  setMainWindow(mainWindow);

  // Reset main window zoom to 1.0 on startup
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow!.webContents.setZoomFactor(1.0);
    mainWindow!.webContents.invalidate();
    eventLogger.success('App', 'React UI loaded successfully');
  });

  // Set up IPC handlers
  const { handleCreateSession } = setupIPC(mainWindow);

  // Register global shortcuts
  setupGlobalShortcuts();

  // Set up CLI server
  setupCLIServer(mainWindow, handleCreateSession);

  // Handle app events
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = WindowService.createMainWindow();
      setupApplicationMenu(mainWindow);
      setMainWindow(mainWindow);
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS, keep app running even when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Unregister global shortcuts
  unregisterGlobalShortcuts();

  // Clean up resources
  if (mainWindow) {
    mainWindow.destroy();
    mainWindow = null;
  }
});
