// DOM Content Extraction IPC Handlers

import { ipcMain } from 'electron';
import { IPCChannels } from '../../../shared/types';
import { TabManager } from '../../tabs';
import { cachePageContent } from '../../agent/rag/cache';
import { eventLogger } from '../../logging/event-logger';
import { getSessionManager } from '../index';

export function setupDOMHandlers(tabManager: TabManager): void {
  ipcMain.handle(IPCChannels.dom.content, async (event, data: {
    tabId: string;
    content: string;
    htmlContent?: string;
    url: string;
    title: string;
  }) => {
    // Get the actual tabId by looking up which BrowserView sent this message
    let actualTabId = data.tabId;
    if (data.tabId === 'current-tab' || !data.tabId) {
      const senderWebContentsId = event.sender.id;
      const resolvedTabId = tabManager.getTabIdByWebContents(senderWebContentsId);

      if (resolvedTabId) {
        actualTabId = resolvedTabId;
        eventLogger.debug('IPC', `Resolved tabId from "${data.tabId}" to "${actualTabId}" for URL: ${data.url}`);
      } else {
        eventLogger.warning('IPC', `Could not resolve tabId for DOM_CONTENT from URL: ${data.url}. Using provided tabId: ${data.tabId}`);
      }
    }

    console.log(`DOM_CONTENT IPC handler called for tab ${actualTabId}: ${data.title}`);
    eventLogger.info('QA Service', `Received page content for tab ${actualTabId}: ${data.title}`);

    // Filter out internal/UI URLs - only embed actual web pages
    const url = data.url.toLowerCase();
    const isDev = process.env.NODE_ENV === 'development';
    const isDevSampleFile = isDev && url.includes('dev-sample.html');
    const isTestBookingFile = isDev && url.includes('test-booking.html');
    const isInternalUrl =
      url.startsWith('http://localhost') ||
      url.startsWith('https://localhost') ||
      url.startsWith('http://127.0.0.1') ||
      url.startsWith('https://127.0.0.1') ||
      url.startsWith('about:') ||
      (url.startsWith('file://') && !isDevSampleFile && !isTestBookingFile) ||
      url.startsWith('chrome://') ||
      url.startsWith('chrome-extension://') ||
      url === '' ||
      url === 'about:blank';

    if (isInternalUrl) {
      console.log(`⏭️ Skipping embedding for internal URL: ${data.url}`);
      eventLogger.info('QA Service', `Skipping internal URL: ${data.url}`);
      return { success: true, skipped: true };
    }

    // Cache page content for QA system (non-blocking)
    // Use setImmediate to make this async and not block the IPC handler
    setImmediate(async () => {
      try {
        // Try to get sessionId for this tab
        let sessionId: string | undefined;
        const sessionManager = getSessionManager();
        if (sessionManager) {
          const foundSessionId = sessionManager.getSessionIdByTabId(actualTabId);
          sessionId = foundSessionId || undefined;
        }
        
        await cachePageContent(
          actualTabId,
          data.content,
          data.htmlContent || '',
          data.url,
          data.title,
          sessionId
        );
        console.log(`✅ Cached page content for tab ${actualTabId}`);
        eventLogger.success('QA Service', `Successfully cached page content for tab ${actualTabId}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to cache page content for tab ${actualTabId}:`, error);
        eventLogger.error('QA Service', `Failed to cache page content for tab ${actualTabId}`, errorMessage);
      }
    });

    // Return immediately - processing happens asynchronously
    return { success: true, processing: true };
  });
}

