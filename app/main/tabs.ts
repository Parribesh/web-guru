import { BrowserWindow, BrowserView } from 'electron';
import { v4 as uuidv4 } from 'uuid'; // TODO: Add uuid dependency
import { Tab } from '../shared/types';
import { createBrowserView, updateBrowserViewBounds, setBrowserViewBounds } from './windows';
import * as path from 'path';

const BROWSER_UI_HEIGHT = 40; // space for top title bar only
const VIEWPORT_RATIO = 0.5; // left half for page, right half for agent/chat

export class TabManager {
  private tabs: Map<string, Tab> = new Map();
  private views: Map<string, BrowserView> = new Map();
  private activeTabId: string | null = null;
  private mainWindow: BrowserWindow;
  private preloadPath: string;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    this.preloadPath = path.join(__dirname, '../../preload/preload/index.js');

    // Create initial tab
    this.createTab().catch(console.error);
  }

  async createTab(url?: string): Promise<string> {
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
    const view = await createBrowserView(tab, this.preloadPath);
    this.views.set(tabId, view);

    // Add view to window but don't show yet
    this.mainWindow.addBrowserView(view);
    setBrowserViewBounds(view, this.mainWindow);

    // If this is the first tab, make it active
    if (!this.activeTabId) {
      this.switchToTab(tabId);
    }

    return tabId;
  }

  async closeTab(tabId: string): Promise<boolean> {
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
        this.createTab().catch(console.error);
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
      setBrowserViewBounds(newView, this.mainWindow);
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

  zoomActiveTab(delta: number): boolean {
    const activeTabId = this.getActiveTabId();
    if (!activeTabId) {
      return false;
    }

    const activeView = this.views.get(activeTabId);
    if (!activeView) {
      return false;
    }

    // Method 1: Try BrowserView zoom
    try {
      console.log(`Attempting BrowserView zoom, delta: ${delta}`);

      // Check if page is loaded
      const url = activeView.webContents.getURL();
      console.log(`Current URL: ${url}`);

      if (url) { // Allow zooming on any URL including about:blank for testing
        const currentZoom = activeView.webContents.getZoomFactor();
        console.log(`BrowserView zoom - current: ${currentZoom}`);

        const newZoom = delta > 0 ?
          Math.min(currentZoom + delta, 5.0) :
          Math.max(currentZoom + delta, 0.1);

        console.log(`BrowserView zoom - setting to: ${newZoom}`);
        activeView.webContents.setZoomFactor(newZoom);

        // Alternative: Try browser zoom via JavaScript
        try {
          activeView.webContents.executeJavaScript(`
            document.body.style.zoom = '${newZoom * 100}%';
            console.log('Applied CSS zoom:', '${newZoom * 100}%');
          `).catch(err => console.log('CSS zoom failed:', err));
        } catch (jsError) {
          console.log('JavaScript zoom execution failed:', jsError);
        }

        // Simple visual refresh - no hiding/showing to avoid flicker
        activeView.webContents.invalidate();

        // Verify the zoom was set
        setTimeout(() => {
          const verifyZoom = activeView.webContents.getZoomFactor();
          console.log(`BrowserView zoom - verified as: ${verifyZoom}`);
        }, 100);

        // Wait a bit and verify
        setTimeout(() => {
          const verifyZoom = activeView.webContents.getZoomFactor();
          console.log(`BrowserView zoom - verified as: ${verifyZoom}`);
        }, 100);

        return true;
      } else {
        console.log('Cannot zoom - no content loaded or about:blank');
        return false;
      }
    } catch (error) {
      console.error('BrowserView zoom failed:', error);
      return false;
    }
  }

  resetZoomActiveTab(): boolean {
    const activeTabId = this.getActiveTabId();
    if (!activeTabId) {
      return false;
    }

    const activeView = this.views.get(activeTabId);
    if (!activeView) {
      return false;
    }

    activeView.webContents.setZoomFactor(1.0);
    return true;
  }

  // Handle window resize
  onWindowResize(width: number, height: number) {
    if (this.activeTabId) {
      const view = this.views.get(this.activeTabId);
      if (view) {
        setBrowserViewBounds(view, this.mainWindow);
      }
    }
  }
}
