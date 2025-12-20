// Bounds utilities for BrowserView positioning

import { BrowserWindow, BrowserView } from 'electron';

/**
 * Updates BrowserView bounds
 */
export function updateBrowserViewBounds(
  view: BrowserView,
  bounds: Electron.Rectangle
): void {
  view.setBounds(bounds);
}

/**
 * Sets BrowserView bounds based on window size and layout
 */
export function setBrowserViewBounds(
  view: BrowserView,
  window: BrowserWindow
): void {
  // Use getContentBounds() to get the actual content area (excluding frame)
  const { width, height } = window.getContentBounds();

  // Account for session header (back button + title) + address bar
  // These values should match the React component heights
  const headerHeight = 60; // Session header (px)
  const addressBarHeight = 48; // Address bar (px)
  const topOffset = headerHeight + addressBarHeight;

  // Calculate available space
  const availableHeight = Math.max(0, height - topOffset);
  const viewportWidth = Math.max(0, Math.floor(width * 0.5)); // Left half for page (50%)

  // Set bounds with proper positioning
  view.setBounds({
    x: 0,
    y: topOffset,
    width: viewportWidth,
    height: availableHeight,
  });

  // Debug logging (can be removed in production)
  if (process.env.NODE_ENV === 'development') {
    console.log(`📐 BrowserView bounds updated:`, {
      windowSize: { width, height },
      bounds: {
        x: 0,
        y: topOffset,
        width: viewportWidth,
        height: availableHeight,
      },
      topOffset,
    });
  }
}

