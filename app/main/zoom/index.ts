// Zoom Management

import { BrowserWindow } from 'electron';
import { getTabManager } from '../ipc';

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

export function handleZoom(delta: number): void {
  // Zoom the React UI (main window)
  if (mainWindow) {
    const currentZoom = mainWindow.webContents.getZoomFactor();
    const newZoom =
      delta > 0
        ? Math.min(currentZoom + delta, 5.0)
        : Math.max(currentZoom + delta, 0.1);
    mainWindow.webContents.setZoomFactor(newZoom);
    mainWindow.webContents.invalidate();
  }

  // Zoom the BrowserView (web content)
  const tabsManager = getTabManager();
  if (tabsManager) {
    tabsManager.zoomActiveTab(delta);
  }
}

export function handleZoomReset(): void {
  // Reset React UI (main window) zoom
  if (mainWindow) {
    mainWindow.webContents.setZoomFactor(1.0);
    mainWindow.webContents.invalidate();
  }

  // Reset BrowserView (web content) zoom
  const tabsManager = getTabManager();
  if (tabsManager) {
    tabsManager.resetZoomActiveTab();
  }
}

