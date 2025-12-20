// Security Handlers

import { app } from 'electron';

/**
 * Prevent multiple instances of the application
 */
export function preventMultipleInstances(onSecondInstance: () => void): boolean {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
    return false;
  } else {
    app.on('second-instance', onSecondInstance);
    return true;
  }
}

/**
 * Set up security handlers to prevent navigation to external protocols
 */
export function setupSecurityHandlers(): void {
  app.on('web-contents-created', (event, contents) => {
    contents.on('will-navigate', (event, navigationUrl) => {
      const parsedUrl = new URL(navigationUrl);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        event.preventDefault();
      }
    });
  });
}

