import { BrowserWindow, BrowserView } from 'electron';
import { v4 as uuidv4 } from 'uuid'; // TODO: Add uuid dependency
import { Tab } from '../shared/types';
import { createBrowserView, updateBrowserViewBounds } from './windows';
import * as path from 'path';

export class TabManager {
  private tabs: Map<string, Tab> = new Map();
  private views: Map<string, BrowserView> = new Map();
  private activeTabId: string | null = null;
  private mainWindow: BrowserWindow;
  private preloadPath: string;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    this.preloadPath = path.join(__dirname, '../preload/preload/index.js');

    // Create initial tab
    this.createTab();
  }

  createTab(url?: string): string {
    const tabId = uuidv4();
    const tab: Tab = {
      id: tabId,
      url: url || '',
      title: 'New Tab',
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
    };

    this.tabs.set(tabId, tab);

    // Create BrowserView for this tab
    const view = createBrowserView(tab, this.preloadPath);
    this.views.set(tabId, view);

    // Add view to window but don't show yet
    this.mainWindow.addBrowserView(view);

    // If this is the first tab, make it active
    if (!this.activeTabId) {
      this.switchToTab(tabId);
    }

    return tabId;
  }

  closeTab(tabId: string): boolean {
    if (!this.tabs.has(tabId)) {
      return false;
    }

    // Remove tab from collections
    this.tabs.delete(tabId);

    // Destroy and remove BrowserView
    const view = this.views.get(tabId);
    if (view) {
      this.mainWindow.removeBrowserView(view);
      this.views.delete(tabId);
    }

    // If closing active tab, switch to another tab
    if (this.activeTabId === tabId) {
      const remainingTabs = Array.from(this.tabs.keys());
      if (remainingTabs.length > 0) {
        this.switchToTab(remainingTabs[0]);
      } else {
        // Create new tab if no tabs left
        this.createTab();
      }
    }

    return true;
  }

  switchToTab(tabId: string): boolean {
    if (!this.tabs.has(tabId)) {
      return false;
    }

    // Hide current active view
    if (this.activeTabId) {
      const currentView = this.views.get(this.activeTabId);
      if (currentView) {
        this.mainWindow.removeBrowserView(currentView);
      }
    }

    // Show new active view
    const newView = this.views.get(tabId);
    if (newView) {
      this.mainWindow.addBrowserView(newView);
      this.activeTabId = tabId;

      // Update view bounds to fill window
      const [width, height] = this.mainWindow.getSize();
      updateBrowserViewBounds(newView, {
        x: 0,
        y: 80, // Leave space for UI
        width,
        height: height - 80
      });
    }

    return true;
  }

  navigate(tabId: string, url: string): boolean {
    const view = this.views.get(tabId);
    if (!view) {
      return false;
    }

    // Ensure URL has protocol
    let fullUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      fullUrl = `https://${url}`;
    }

    view.webContents.loadURL(fullUrl);
    return true;
  }

  goBack(tabId: string): boolean {
    const view = this.views.get(tabId);
    if (!view || !view.webContents.canGoBack()) {
      return false;
    }

    view.webContents.goBack();
    return true;
  }

  goForward(tabId: string): boolean {
    const view = this.views.get(tabId);
    if (!view || !view.webContents.canGoForward()) {
      return false;
    }

    view.webContents.goForward();
    return true;
  }

  reload(tabId: string): boolean {
    const view = this.views.get(tabId);
    if (!view) {
      return false;
    }

    view.webContents.reload();
    return true;
  }

  stopLoading(tabId: string): boolean {
    const view = this.views.get(tabId);
    if (!view) {
      return false;
    }

    view.webContents.stop();
    return true;
  }

  getTabs(): Tab[] {
    return Array.from(this.tabs.values());
  }

  getActiveTab(): Tab | null {
    return this.activeTabId ? this.tabs.get(this.activeTabId) || null : null;
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  updateTabInfo(tabId: string, updates: Partial<Tab>): boolean {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      return false;
    }

    Object.assign(tab, updates);
    return true;
  }

  // Handle window resize
  onWindowResize(width: number, height: number) {
    if (this.activeTabId) {
      const view = this.views.get(this.activeTabId);
      if (view) {
        updateBrowserViewBounds(view, {
          x: 0,
          y: 80,
          width,
          height: height - 80
        });
      }
    }
  }
}
