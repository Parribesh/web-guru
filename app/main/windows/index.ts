// Windows module - exports for window and view services

export { WindowService } from './WindowService';
export { ViewService } from './ViewService';
export { updateBrowserViewBounds, setBrowserViewBounds } from './bounds';

// Legacy exports for backward compatibility during migration
import { WindowService } from './WindowService';
import { ViewService } from './ViewService';

export function createMainWindow() {
  return WindowService.createMainWindow();
}

export async function createBrowserView(
  tab: any,
  preloadPath: string,
  mainWindow?: any
) {
  return ViewService.createBrowserView(tab, preloadPath, mainWindow);
}

export function destroyBrowserView(view: any) {
  return ViewService.destroyBrowserView(view);
}

