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
import { getWorkerPool, shutdownWorkerPool } from './agent/rag/worker-pool';

// Global error handlers for crash reporting
import * as fs from 'fs';
import * as path from 'path';

function writeCrashReport(report: any): void {
  try {
    // Always write to project directory for easy access
    const projectLogPath = path.join(process.cwd(), 'crash-reports.log');
    const reportLine = `[${new Date().toISOString()}] ${JSON.stringify(report, null, 2)}\n\n`;
    fs.appendFileSync(projectLogPath, reportLine, 'utf8');
    console.error(`[CRASH REPORT] Written to: ${projectLogPath}`);
    
    // Also write to userData if app is ready
    if (app.isReady()) {
      try {
        const userDataLogPath = path.join(app.getPath('userData'), 'crash-reports.log');
        fs.appendFileSync(userDataLogPath, reportLine, 'utf8');
        console.error(`[CRASH REPORT] Also written to: ${userDataLogPath}`);
      } catch (err) {
        // Ignore userData write errors
      }
    }
  } catch (err) {
    console.error('[CRASH REPORT] Failed to write crash report to file:', err);
  }
}

process.on('uncaughtException', (error: Error) => {
  const errorReport = {
    type: 'uncaughtException',
    message: error.message,
    stack: error.stack,
    name: error.name,
    timestamp: new Date().toISOString(),
  };
  
  console.error('[CRASH REPORT] Uncaught Exception:', errorReport);
  console.error('[CRASH REPORT] Full error:', error);
  eventLogger.error('Crash Report', `Uncaught Exception: ${error.message}`, errorReport);
  
  // Write to file
  writeCrashReport(errorReport);
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  const errorReport = {
    type: 'unhandledRejection',
    reason: reason instanceof Error ? {
      message: reason.message,
      stack: reason.stack,
      name: reason.name,
    } : String(reason),
    timestamp: new Date().toISOString(),
  };
  
  console.error('[CRASH REPORT] Unhandled Rejection:', errorReport);
  console.error('[CRASH REPORT] Full rejection:', reason, promise);
  eventLogger.error('Crash Report', `Unhandled Rejection: ${reason instanceof Error ? reason.message : String(reason)}`, errorReport);
  
  // Write to file
  writeCrashReport(errorReport);
});

// Handle worker thread errors
process.on('warning', (warning: Error) => {
  console.warn('[WARNING]', warning.name, warning.message);
  if (warning.stack) {
    console.warn('[WARNING] Stack:', warning.stack);
  }
  eventLogger.warning('Process Warning', warning.message, { name: warning.name, stack: warning.stack });
});

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

  // Initialize worker pool early so workers are ready when embeddings are needed
  // This prevents delays when embedding generation starts
  eventLogger.info('App', 'Initializing embedding worker pool in background...');
  getWorkerPool().waitForInitialization().then(() => {
    eventLogger.success('App', 'Embedding worker pool initialized and ready');
  }).catch((error) => {
    eventLogger.error('App', `Failed to initialize worker pool: ${error.message}`);
    eventLogger.warning('App', 'Embeddings will use fallback processing if worker pool fails');
  });

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

app.on('before-quit', async () => {
  // Unregister global shortcuts
  unregisterGlobalShortcuts();
  
  // Shutdown worker pool
  try {
    await shutdownWorkerPool();
    eventLogger.info('App', 'Worker pool shut down');
  } catch (error: any) {
    eventLogger.error('App', `Error shutting down worker pool: ${error.message}`);
  }

  // Clean up resources
  if (mainWindow) {
    mainWindow.destroy();
    mainWindow = null;
  }
  
  // Close log file
  eventLogger.shutdown();
});
