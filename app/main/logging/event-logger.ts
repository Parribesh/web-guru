import { BrowserWindow } from 'electron';

export enum LogLevel {
  INFO = 'info',
  SUCCESS = 'success',
  WARNING = 'warning',
  ERROR = 'error',
  DEBUG = 'debug',
}

export interface LogEvent {
  id: string;
  timestamp: number;
  level: LogLevel;
  category: string;
  message: string;
  details?: any;
  progress?: {
    current: number;
    total: number;
    percentage?: number;
  };
}

class EventLogger {
  private mainWindow: BrowserWindow | null = null;
  private eventIdCounter = 0;
  private maxEvents = 1000; // Keep last 1000 events
  private events: LogEvent[] = [];

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }

  private generateId(): string {
    return `event-${Date.now()}-${++this.eventIdCounter}`;
  }

  private emit(event: LogEvent) {
    // Ensure timestamp is valid
    if (!event.timestamp || isNaN(event.timestamp)) {
      event.timestamp = Date.now();
    }
    
    // Store event
    this.events.push(event);
    
    // Keep only last maxEvents
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    // Send to renderer if window is available
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        // Create a clean copy for IPC (ensure all fields are serializable)
        const ipcEvent: LogEvent = {
          id: event.id,
          timestamp: event.timestamp,
          level: event.level,
          category: event.category,
          message: event.message,
          details: event.details,
          progress: event.progress,
        };
        
        // Send event to renderer
        this.mainWindow.webContents.send('log:event', ipcEvent);
        
        // Debug: verify event was sent
        const msgPreview = event.message ? event.message.substring(0, 50) : 'NO MESSAGE';
        console.log(`[EventLogger] Sent event to renderer: ${event.category} - ${msgPreview}`, ipcEvent);
      } catch (error: any) {
        // Window might be closing, ignore silently
        // Only log critical errors that prevent event logging
        if (error && error.message && !error.message.includes('Object has been destroyed')) {
          // Use console.error only for critical setup issues
          console.error('[EventLogger] Critical: Failed to send event to renderer:', error.message);
        }
      }
    } else {
      // Debug: log when mainWindow is not available
      if (!this.mainWindow) {
        console.warn('[EventLogger] Main window not set - event not sent:', event.category, event.message.substring(0, 50));
      }
    }
  }

  private getConsoleMethod(level: LogLevel): typeof console.log {
    switch (level) {
      case LogLevel.ERROR:
        return console.error;
      case LogLevel.WARNING:
        return console.warn;
      case LogLevel.DEBUG:
        return console.debug;
      default:
        return console.log;
    }
  }

  log(level: LogLevel, category: string, message: string, details?: any, progress?: { current: number; total: number }) {
    const event: LogEvent = {
      id: this.generateId(),
      timestamp: Date.now(),
      level,
      category,
      message,
      details,
      progress: progress ? {
        current: progress.current,
        total: progress.total,
        percentage: Math.round((progress.current / progress.total) * 100),
      } : undefined,
    };

    this.emit(event);
  }

  info(category: string, message: string, details?: any) {
    this.log(LogLevel.INFO, category, message, details);
  }

  success(category: string, message: string, details?: any) {
    this.log(LogLevel.SUCCESS, category, message, details);
  }

  warning(category: string, message: string, details?: any) {
    this.log(LogLevel.WARNING, category, message, details);
  }

  error(category: string, message: string, details?: any) {
    this.log(LogLevel.ERROR, category, message, details);
  }

  debug(category: string, message: string, details?: any) {
    this.log(LogLevel.DEBUG, category, message, details);
  }

  progress(category: string, message: string, current: number, total: number, details?: any) {
    this.log(LogLevel.INFO, category, message, details, { current, total });
  }

  // Get all events (for initial load)
  getEvents(): LogEvent[] {
    return [...this.events];
  }

  // Clear events
  clear() {
    this.events = [];
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('log:clear');
    }
  }
}

// Singleton instance
export const eventLogger = new EventLogger();

