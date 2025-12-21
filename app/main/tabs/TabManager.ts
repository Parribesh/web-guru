// Tab Manager - Manages browser tabs and their associated BrowserViews

import { BrowserWindow, BrowserView } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { Tab } from '../../shared/types';
import { ViewService } from '../windows/ViewService';
import { setBrowserViewBounds } from '../windows/bounds';
import { eventLogger } from '../logging/event-logger';
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
    this.preloadPath = path.resolve(__dirname, '../../../preload/preload/index.js');

    // Note: BrowserView bounds are now controlled by React via ResizeObserver
    // React sends bounds updates via IPC, so we don't need window resize handlers here

    // Don't create initial tab - tabs will be created by sessions
    // const isDev = process.env.NODE_ENV === 'development';
    // const defaultUrl = isDev ? this.getDevDefaultUrl() : undefined;
    // this.createTab(defaultUrl).catch(console.error);
  }

  // Cleanup method
  getBrowserView(tabId: string): BrowserView | null {
    return this.views.get(tabId) || null;
  }

  destroy(): void {
    // Clean up all views
    this.views.forEach((view) => {
      this.mainWindow.removeBrowserView(view);
    });
    this.views.clear();
    this.tabs.clear();
  }

  private getDevDefaultUrl(): string {
    // Use a local HTML file for development
    // In compiled code, __dirname is dist/main/main/
    // In source code, __dirname is app/main/
    // We need to go up to the project root and then into app/
    let devSamplePath: string;

    if (__dirname.includes('dist')) {
      // Compiled: dist/main/main/ -> go up to project root, then app/
      const projectRoot = path.resolve(__dirname, '../../../../');
      devSamplePath = path.join(projectRoot, 'app', 'dev-sample.html');
    } else {
      // Source: app/main/ -> go up to app/
      devSamplePath = path.join(__dirname, '../../dev-sample.html');
    }

    const normalizedPath = path.resolve(devSamplePath);
    console.log(`[TabManager] Dev sample path: ${normalizedPath}`);
    console.log(`[TabManager] __dirname: ${__dirname}`);

    // Verify file exists
    const fs = require('fs');
    if (!fs.existsSync(normalizedPath)) {
      console.error(
        `[TabManager] Dev sample file not found at: ${normalizedPath}`
      );
      // Fallback: try to find it relative to process.cwd()
      const fallbackPath = path.join(process.cwd(), 'app', 'dev-sample.html');
      if (fs.existsSync(fallbackPath)) {
        console.log(`[TabManager] Using fallback path: ${fallbackPath}`);
        return `file://${path.resolve(fallbackPath)}`;
      }
    }

    return `file://${normalizedPath}`;
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
    const view = await ViewService.createBrowserView(
      tab,
      this.preloadPath,
      this.mainWindow
    );
    this.views.set(tabId, view);

    // Add view to window but keep it hidden by default
    // BrowserViews are created hidden and will only be shown when explicitly requested
    // via session:show-view IPC call (typically from SessionViewWrapper component)
    this.mainWindow.addBrowserView(view);
    // Hide the view by setting bounds outside the window
    view.setBounds({ x: -10000, y: -10000, width: 0, height: 0 });

    // Don't auto-activate tabs - they'll be activated when their session is selected
    // if (!this.activeTabId) {
    //   this.switchToTab(tabId);
    // }

    // If URL was provided, navigate to it
    if (url) {
      // Small delay to ensure view is ready
      setTimeout(() => {
        this.navigate(tabId, url);
      }, 100);
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
        // Hide by moving off-screen instead of removing
        currentView.setBounds({ x: -10000, y: -10000, width: 0, height: 0 });
      }
    }

    // Show new active view
    const newView = this.views.get(tabId);
    if (newView) {
      // Ensure view is added to window
      this.mainWindow.addBrowserView(newView);
      this.activeTabId = tabId;
      // Update bounds immediately and ensure it stays updated
      setBrowserViewBounds(newView, this.mainWindow);
      // Force a bounds update after a small delay to handle any race conditions
      setTimeout(() => {
        if (this.activeTabId === tabId) {
          setBrowserViewBounds(newView, this.mainWindow);
        }
      }, 50);
    }

    return true;
  }

  navigate(tabId: string, url: string): boolean {
    const view = this.views.get(tabId);
    if (!view) {
      eventLogger.error(
        'Navigation',
        `Cannot navigate: View not found for tab ${tabId}`
      );
      return false;
    }

    // Ensure URL has protocol (but preserve file:// URLs)
    let fullUrl = url;
    if (
      !url.startsWith('http://') &&
      !url.startsWith('https://') &&
      !url.startsWith('file://')
    ) {
      fullUrl = `https://${url}`;
    }

    eventLogger.info('Navigation', `Fetching article: ${fullUrl}`);
    eventLogger.info('Navigation', `Tab ID: ${tabId}`);

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

  // Find tabId by webContents (for IPC handlers)
  getTabIdByWebContents(webContentsId: number): string | null {
    for (const [tabId, view] of this.views.entries()) {
      if (view.webContents.id === webContentsId) {
        return tabId;
      }
    }
    return null;
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

      if (url) {
        // Allow zooming on any URL including about:blank for testing
        const currentZoom = activeView.webContents.getZoomFactor();
        console.log(`BrowserView zoom - current: ${currentZoom}`);

        const newZoom =
          delta > 0
            ? Math.min(currentZoom + delta, 5.0)
            : Math.max(currentZoom + delta, 0.1);

        console.log(`BrowserView zoom - setting to: ${newZoom}`);

        // AGGRESSIVE: Remove view, set zoom, re-add to force visual refresh
        const currentBounds = activeView.getBounds();
        this.mainWindow.removeBrowserView(activeView);

        // Set zoom while view is removed
        activeView.webContents.setZoomFactor(newZoom);

        // Re-add the view to force complete re-render
        this.mainWindow.addBrowserView(activeView);
        activeView.setBounds(currentBounds);

        // Force multiple refresh methods
        activeView.webContents.invalidate();

        // Force a repaint by toggling visibility
        setTimeout(() => {
          activeView.setBounds({
            ...currentBounds,
            height: currentBounds.height - 1,
          });
          setTimeout(() => {
            activeView.setBounds(currentBounds);
            activeView.webContents.invalidate();
          }, 10);
        }, 50);

        // Verify the zoom was set
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
      console.log('❌ No active tab to reset zoom');
      return false;
    }

    const activeView = this.views.get(activeTabId);
    if (!activeView) {
      console.log('❌ No active BrowserView found for tab:', activeTabId);
      return false;
    }

    const currentZoom = activeView.webContents.getZoomFactor();
    console.log(`🔄 Resetting zoom from ${currentZoom} to 1.0`);

    // AGGRESSIVE: Remove view, reset zoom, re-add to force visual refresh
    const currentBounds = activeView.getBounds();
    this.mainWindow.removeBrowserView(activeView);

    // Set zoom to 1.0 while view is removed
    activeView.webContents.setZoomFactor(1.0);

    // Re-add the view to force complete re-render
    this.mainWindow.addBrowserView(activeView);
    activeView.setBounds(currentBounds);

    // Force visual refresh
    activeView.webContents.invalidate();

    // Force a repaint by toggling bounds
    setTimeout(() => {
      activeView.setBounds({
        ...currentBounds,
        height: currentBounds.height - 1,
      });
      setTimeout(() => {
        activeView.setBounds(currentBounds);
        activeView.webContents.invalidate();
      }, 10);
    }, 50);

    // Verify the reset
    setTimeout(() => {
      const verifyZoom = activeView.webContents.getZoomFactor();
      console.log(`✅ Zoom reset verified: ${verifyZoom}`);
    }, 100);

    return true;
  }

  // Handle window resize
  onWindowResize(width: number, height: number): void {
    if (this.activeTabId) {
      const view = this.views.get(this.activeTabId);
      if (view) {
        setBrowserViewBounds(view, this.mainWindow);
      }
    }
  }
}

