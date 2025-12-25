// Main Process Entry Point

// Load environment variables from .env file
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env file from project root
const envPath = path.join(process.cwd(), '.env');
dotenv.config({ path: envPath });
console.log(`[Config] Loading .env from: ${envPath}`);
console.log(`[Config] EMBEDDING_BATCH_SIZE: ${process.env.EMBEDDING_BATCH_SIZE || 'not set (using default: 4)'}`);

import { app, BrowserWindow } from 'electron';
import { setupIPC, getTabManager, getSessionManager } from './ipc';
import { WindowService } from './windows/WindowService';
import { eventLogger } from './logging/event-logger';
import { setupApplicationMenu } from './menu';
import { setupGlobalShortcuts, unregisterGlobalShortcuts } from './shortcuts';
import { setMainWindow } from './zoom';
import { setupCLIServer } from './cli/server';
import { preventMultipleInstances, setupSecurityHandlers } from './security';
import { shutdownEmbeddingService } from './agent/rag/embedding-service';

// Global error handlers for crash reporting
import * as fs from 'fs';

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

  // Initialize session storage (load URL mappings from disk)
  const { initializeUrlMapping } = require('./agent/rag/session-storage');
  initializeUrlMapping();

  // Check embedding service availability
  const { getEmbeddingService } = require('./agent/rag/embedding-service');
  const embeddingService = getEmbeddingService();
  embeddingService.healthCheck().then((available: boolean) => {
    if (available) {
      eventLogger.success('App', 'Embedding HTTP service is available');
    } else {
      eventLogger.warning('App', 'Embedding HTTP service is not available, will use fallback processing');
    }
  }).catch((error: any) => {
    eventLogger.warning('App', `Failed to check embedding service: ${error.message}`);
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
  
  // Shutdown embedding service
  try {
    shutdownEmbeddingService();
    eventLogger.info('App', 'Embedding service shut down');
  } catch (error: any) {
    eventLogger.error('App', `Error shutting down embedding service: ${error.message}`);
  }

  // Clean up resources
  if (mainWindow) {
    mainWindow.destroy();
    mainWindow = null;
  }
  
  // Close log file
  eventLogger.shutdown();
});
