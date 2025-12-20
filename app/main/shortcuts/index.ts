// Global Keyboard Shortcuts

import { globalShortcut } from 'electron';
import { handleZoom, handleZoomReset } from '../zoom';

export function setupGlobalShortcuts(): void {
  // Zoom In shortcuts
  globalShortcut.register('CommandOrControl+=', () => {
    handleZoom(0.1);
  });

  globalShortcut.register('CommandOrControl+Plus', () => {
    handleZoom(0.1);
  });

  globalShortcut.register('CommandOrControl+Shift+=', () => {
    handleZoom(0.1);
  });

  // Zoom Out shortcuts
  const zoomOutAccelerators = [
    'CommandOrControl+-',
    'CommandOrControl+Minus',
  ];

  for (const accel of zoomOutAccelerators) {
    try {
      globalShortcut.register(accel, () => {
        handleZoom(-0.1);
      });
      break; // Use the first one that works
    } catch (error) {
      // Try next accelerator
    }
  }

  // Reset Zoom
  globalShortcut.register('CommandOrControl+0', () => {
    handleZoomReset();
  });
}

export function unregisterGlobalShortcuts(): void {
  globalShortcut.unregisterAll();
}

