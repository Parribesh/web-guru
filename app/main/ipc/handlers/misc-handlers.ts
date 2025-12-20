// Miscellaneous IPC Handlers (QA, Logging, Window, DevTools)

import { ipcMain, BrowserWindow } from 'electron';
import { IPCChannels, QARequest } from '../../../shared/types';
import { eventLogger } from '../../logging/event-logger';
import { answerQuestion } from '../../agent/qa/service';

export function setupMiscHandlers(mainWindow: BrowserWindow): void {
  // QA request handler
  ipcMain.handle(IPCChannels.qa.ask, async (event, request: QARequest) => {
    console.log(`QA request for tab ${request.tabId}: ${request.question}`);
    return await answerQuestion(request);
  });

  // Logging handlers
  ipcMain.handle(IPCChannels.log.getEvents, () => {
    return eventLogger.getEvents();
  });

  ipcMain.handle(IPCChannels.log.clear, () => {
    eventLogger.clear();
    return { success: true };
  });

  // Window management
  ipcMain.handle(IPCChannels.window.minimize, async () => {
    mainWindow.minimize();
  });

  ipcMain.handle(IPCChannels.window.maximize, async () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.handle(IPCChannels.window.close, async () => {
    mainWindow.close();
  });

  // Dev tools
  ipcMain.handle(IPCChannels.devTools.open, async (event, tabId?: string) => {
    if (tabId) {
      // TODO: Implement per-tab dev tools
      console.log(`Opening dev tools for tab: ${tabId}`);
    } else {
      mainWindow.webContents.openDevTools();
    }
  });
}

