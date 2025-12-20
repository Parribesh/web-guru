// Tab Management IPC Handlers

import { ipcMain } from 'electron';
import { IPCChannels } from '../../../shared/types';
import { TabManager } from '../../tabs';

export function setupTabHandlers(tabManager: TabManager): void {
  ipcMain.handle(IPCChannels.tab.create, async (event, url?: string) => {
    const tabId = await tabManager.createTab(url);
    const tabs = tabManager.getTabs();
    return { tabId, tabs };
  });

  ipcMain.handle(IPCChannels.tab.close, async (event, tabId: string) => {
    const success = await tabManager.closeTab(tabId);
    const tabs = tabManager.getTabs();
    const activeTabId = tabManager.getActiveTabId();
    return { success, tabs, activeTabId };
  });

  ipcMain.handle(IPCChannels.tab.switch, async (event, tabId: string) => {
    const success = tabManager.switchToTab(tabId);
    return { success };
  });

  ipcMain.handle(IPCChannels.navigation.navigate, async (event, tabId: string, url: string) => {
    const success = tabManager.navigate(tabId, url);
    return { success };
  });

  ipcMain.handle(IPCChannels.navigation.goBack, async (event, tabId: string) => {
    const success = tabManager.goBack(tabId);
    return { success };
  });

  ipcMain.handle(IPCChannels.navigation.goForward, async (event, tabId: string) => {
    const success = tabManager.goForward(tabId);
    return { success };
  });

  ipcMain.handle(IPCChannels.navigation.reload, async (event, tabId: string) => {
    const success = tabManager.reload(tabId);
    return { success };
  });

  ipcMain.handle(IPCChannels.navigation.stopLoading, async (event, tabId: string) => {
    const success = tabManager.stopLoading(tabId);
    return { success };
  });

  ipcMain.handle(IPCChannels.tab.getAll, async () => {
    return {
      tabs: tabManager.getTabs(),
      activeTabId: tabManager.getActiveTabId(),
    };
  });

  // Zoom handlers
  ipcMain.on(IPCChannels.zoom.in, () => {
    tabManager.zoomActiveTab(0.1);
  });

  ipcMain.on(IPCChannels.zoom.out, () => {
    tabManager.zoomActiveTab(-0.1);
  });

  ipcMain.on(IPCChannels.zoom.reset, () => {
    tabManager.resetZoomActiveTab();
  });
}

