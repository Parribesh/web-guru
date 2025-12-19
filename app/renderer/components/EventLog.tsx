import React, { useState, useEffect, useRef } from 'react';

// Types for log events (duplicated from main process for renderer)
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

interface EventLogProps {
  isOpen: boolean;
  onToggle: () => void;
}

export const EventLog: React.FC<EventLogProps> = ({ isOpen, onToggle }) => {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [filter, setFilter] = useState<LogLevel | 'all'>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load initial events
    const loadEvents = async () => {
      try {
        const initialEvents = await ((window as any).electronAPI?.log?.getEvents() || Promise.resolve([]));
        setEvents(initialEvents || []);
      } catch (error) {
        // Silently fail - events will come via IPC
      }
    };

    loadEvents();

    // Listen for new events
    const handleLogEvent = (event: LogEvent) => {
      // Debug: log received events
      console.log('[EventLog] Received event:', { 
        id: event?.id, 
        category: event?.category, 
        level: event?.level,
        message: event?.message ? event.message.substring(0, 50) : 'NO MESSAGE'
      });
      
      // Validate event exists
      if (!event || typeof event !== 'object') {
        console.warn('[EventLog] Invalid event (not an object):', event);
        return;
      }
      
      // Ensure timestamp is valid
      if (!event.timestamp || isNaN(event.timestamp)) {
        event.timestamp = Date.now();
      }
      
      // Validate event structure
      if (!event.id || !event.category || !event.message) {
        console.warn('[EventLog] Invalid event structure:', event);
        return; // Skip invalid events
      }
      
      setEvents(prev => {
        // Avoid duplicates
        if (prev.some(e => e.id === event.id)) {
          console.log('[EventLog] Duplicate event ignored:', event.id);
          return prev;
        }
        const newEvents = [...prev, event];
        console.log('[EventLog] Added event, total:', newEvents.length);
        // Keep only last 500 events in UI
        return newEvents.slice(-500);
      });
    };

    // Register event listener
    const setupListener = () => {
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI) {
        console.warn('[EventLog] window.electronAPI not available yet, retrying...');
        setTimeout(setupListener, 100);
        return;
      }

      try {
        console.log('[EventLog] Registering event listener for log:event');
        electronAPI.on('log:event', handleLogEvent);
        console.log('[EventLog] Event listener registered successfully');
      } catch (error) {
        console.error('[EventLog] Failed to register event listener:', error);
      }
    };
    
    setupListener();
    
    // Cleanup: remove listener on unmount
    return () => {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI) {
        try {
          electronAPI.off('log:event', handleLogEvent);
          console.log('[EventLog] Event listener removed');
        } catch (error) {
          console.error('[EventLog] Failed to remove event listener:', error);
        }
      }
    };

    return () => {
      try {
        ((window as any).electronAPI as any)?.off('log:event', handleLogEvent);
      } catch (error) {
        // Ignore cleanup errors
      }
    };
  }, []);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  const filteredEvents = filter === 'all' 
    ? events 
    : events.filter(e => e.level === filter);

  const getLevelColor = (level: LogLevel): string => {
    switch (level) {
      case LogLevel.SUCCESS:
        return 'text-green-600 bg-green-50 border-green-200';
      case LogLevel.ERROR:
        return 'text-red-600 bg-red-50 border-red-200';
      case LogLevel.WARNING:
        return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case LogLevel.DEBUG:
        return 'text-gray-500 bg-gray-50 border-gray-200';
      default:
        return 'text-blue-600 bg-blue-50 border-blue-200';
    }
  };

  const getLevelIcon = (level: LogLevel): string => {
    switch (level) {
      case LogLevel.SUCCESS:
        return '✅';
      case LogLevel.ERROR:
        return '❌';
      case LogLevel.WARNING:
        return '⚠️';
      case LogLevel.DEBUG:
        return '🔍';
      default:
        return 'ℹ️';
    }
  };

  const formatTime = (timestamp: number): string => {
    if (!timestamp || isNaN(timestamp)) {
      return '--:--:--';
    }
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) {
        return '--:--:--';
      }
      return date.toLocaleTimeString();
    } catch (error) {
      return '--:--:--';
    }
  };

  const handleClear = async () => {
    try {
      await ((window as any).electronAPI?.log?.clear() || Promise.resolve({ success: false }));
      setEvents([]);
    } catch (error) {
      console.error('Failed to clear events:', error);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="fixed bottom-4 right-4 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg hover:bg-gray-700 z-50"
      >
        📋 Show Logs
      </button>
    );
  }

  return (
    <div className="fixed bottom-0 right-0 w-96 h-96 bg-white dark:bg-gray-800 border-t border-l border-gray-300 dark:border-gray-600 shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-gray-100 dark:bg-gray-700 border-b border-gray-300 dark:border-gray-600">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Event Log</h3>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-1">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="w-3 h-3"
            />
            Auto-scroll
          </label>
          <button
            onClick={handleClear}
            className="text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600"
          >
            Clear
          </button>
          <button
            onClick={onToggle}
            className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-1 p-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        {(['all', LogLevel.INFO, LogLevel.SUCCESS, LogLevel.WARNING, LogLevel.ERROR] as const).map(level => (
          <button
            key={level}
            onClick={() => setFilter(level)}
            className={`text-xs px-2 py-1 rounded ${
              filter === level
                ? 'bg-blue-500 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            {level === 'all' ? 'All' : level.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Events List */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-2 space-y-1"
      >
        {filteredEvents.length === 0 ? (
          <div className="text-center text-gray-500 dark:text-gray-400 py-8">
            No events to display
          </div>
        ) : (
          filteredEvents.map(event => (
            <div
              key={event.id}
              className={`p-2 rounded border text-xs ${getLevelColor(event.level)}`}
            >
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span>{getLevelIcon(event.level)}</span>
                  <span className="font-semibold">{event.category}</span>
                  {event.progress && (
                    <span className="text-xs opacity-75">
                      ({event.progress.current}/{event.progress.total} - {event.progress.percentage}%)
                    </span>
                  )}
                </div>
                <span className="text-xs opacity-75">{formatTime(event.timestamp)}</span>
              </div>
              <div className="text-sm">{event.message}</div>
              {event.details && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs opacity-75">Details</summary>
                  <pre className="mt-1 text-xs overflow-x-auto bg-black bg-opacity-10 p-1 rounded">
                    {typeof event.details === 'string' ? event.details : JSON.stringify(event.details, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="p-2 bg-gray-100 dark:bg-gray-700 border-t border-gray-300 dark:border-gray-600 text-xs text-gray-600 dark:text-gray-400">
        {filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
};

