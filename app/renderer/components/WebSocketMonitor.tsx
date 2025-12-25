import React, { useState, useEffect, useRef } from 'react';

interface WebSocketConnection {
  connected_at: number;
  connected_at_iso: string;
  connection_duration_seconds: number;
  client_host?: string;
  client_port?: number;
}

interface WebSocketStatus {
  status: 'active' | 'idle';
  total_connections: number;
  connections: WebSocketConnection[];
}

interface WebSocketEvent {
  id: string;
  type: string;
  timestamp: number;
  data: any;
}

export const WebSocketMonitor: React.FC = () => {
  const [status, setStatus] = useState<WebSocketStatus | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [events, setEvents] = useState<WebSocketEvent[]>([]);
  const eventsRef = useRef<WebSocketEvent[]>([]);
  const eventIdCounter = useRef<number>(0);

  const fetchWebSocketStatus = async () => {
    try {
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI) {
        setError('electronAPI not available');
        return;
      }

      const response = await electronAPI.utils.invoke('websocket:status');
      
      if (response?.success) {
        setStatus(response.data);
        setError(null);
        setLastUpdate(new Date());
      } else {
        setError(response?.error || 'Failed to fetch WebSocket status');
      }
    } catch (err: any) {
      console.error('[WebSocketMonitor] Error fetching status:', err);
      setError(err.message || 'Unknown error');
    }
  };

  // Listen for embedding-service events via IPC (all types)
  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.on) {
      console.warn('[WebSocketMonitor] electronAPI.on not available');
      return;
    }

    console.log('[WebSocketMonitor] Setting up event listener for embedding-service:event');
    
    const handleEmbeddingEvent = (_event: any, eventData: any) => {
      console.log('[WebSocketMonitor] Received embedding-service event:', eventData?.type, eventData);
      
      if (!eventData) {
        console.warn('[WebSocketMonitor] Received null/undefined eventData');
        return;
      }
      
      // Create event for display (show all events)
      const newEvent: WebSocketEvent = {
        id: `event-${++eventIdCounter.current}`,
        type: eventData.type || 'unknown',
        timestamp: eventData.timestamp || Date.now(),
        data: eventData,
      };
      
      eventsRef.current = [newEvent, ...eventsRef.current].slice(0, 500); // Keep last 500 events
      setEvents([...eventsRef.current]);
      setLastUpdate(new Date());
      
      console.log(`[WebSocketMonitor] Added event ${newEvent.id} (type: ${newEvent.type}), total events: ${eventsRef.current.length}`);
    };

    electronAPI.on('embedding-service:event', handleEmbeddingEvent);
    console.log('[WebSocketMonitor] Event listener registered');

    return () => {
      console.log('[WebSocketMonitor] Cleaning up event listener');
      if (electronAPI?.off) {
        electronAPI.off('embedding-service:event', handleEmbeddingEvent);
      }
    };
  }, []);

  useEffect(() => {
    fetchWebSocketStatus();
    
    if (autoRefresh) {
      const interval = setInterval(fetchWebSocketStatus, 2000); // Refresh every 2 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${minutes}m ${secs}s`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${minutes}m`;
    }
  };

  // Calculate event statistics
  const eventStats = events.reduce((acc, event) => {
    acc[event.type] = (acc[event.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const getEventTypeColor = (type: string): string => {
    const colors: Record<string, string> = {
      'task_complete': 'text-green-600 bg-green-50 border-green-200',
      'task_error': 'text-red-600 bg-red-50 border-red-200',
      'task_progress': 'text-blue-600 bg-blue-50 border-blue-200',
      'task_submitted': 'text-purple-600 bg-purple-50 border-purple-200',
      'websocket_message': 'text-indigo-600 bg-indigo-50 border-indigo-200',
      'job_status_update': 'text-cyan-600 bg-cyan-50 border-cyan-200',
      'job_complete': 'text-emerald-600 bg-emerald-50 border-emerald-200',
      'job_started': 'text-lime-600 bg-lime-50 border-lime-200',
      'websocket_connected': 'text-teal-600 bg-teal-50 border-teal-200',
      'websocket_closed': 'text-amber-600 bg-amber-50 border-amber-200',
      'websocket_error': 'text-red-600 bg-red-50 border-red-200',
      'connected': 'text-teal-600 bg-teal-50 border-teal-200',
      'disconnected': 'text-orange-600 bg-orange-50 border-orange-200',
      'error': 'text-red-600 bg-red-50 border-red-200',
    };
    return colors[type] || 'text-gray-600 bg-gray-50 border-gray-200';
  };

  if (error && !status) {
    return (
      <div className="p-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">Error: {error}</p>
          <button
            onClick={fetchWebSocketStatus}
            className="mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 p-4 bg-gray-50">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800">WebSocket Monitor</h2>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded"
              />
              <span>Auto-refresh</span>
            </label>
            <button
              onClick={() => {
                eventsRef.current = [];
                setEvents([]);
                eventIdCounter.current = 0;
              }}
              className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm"
            >
              Clear Events
            </button>
            <button
              onClick={fetchWebSocketStatus}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
            >
              Refresh
            </button>
            {lastUpdate && (
              <span className="text-xs text-gray-500">
                Last update: {lastUpdate.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-4">
          {/* Event Statistics */}
          <div className="border rounded-lg p-4 bg-white">
            <h3 className="font-semibold text-lg text-gray-800 mb-4">Event Statistics</h3>
            {Object.keys(eventStats).length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {Object.entries(eventStats).map(([type, count]) => (
                  <div
                    key={type}
                    className={`border rounded-lg p-3 ${getEventTypeColor(type)}`}
                  >
                    <div className="text-xs font-medium mb-1">{type}</div>
                    <div className="text-2xl font-bold">{count}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-gray-500 text-center py-4">
                No events received yet
              </div>
            )}
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="text-sm text-gray-600">
                Total Events: <span className="font-semibold text-gray-800">{events.length}</span>
              </div>
            </div>
          </div>

          {/* Connection Status */}
          {status && (
            <div className="border rounded-lg p-4 bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg text-gray-800">Connection Status</h3>
                <div className={`px-4 py-2 rounded-lg font-semibold ${
                  status.status === 'active'
                    ? 'bg-green-100 text-green-800 border border-green-300'
                    : 'bg-gray-100 text-gray-800 border border-gray-300'
                }`}>
                  {status.status === 'active' ? '🟢 Active' : '⚪ Idle'}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-lg p-4 border border-blue-200">
                  <div className="text-sm text-gray-600 mb-1">Total Connections</div>
                  <div className="text-3xl font-bold text-blue-900">{status.total_connections}</div>
                </div>
                <div className="bg-white rounded-lg p-4 border border-blue-200">
                  <div className="text-sm text-gray-600 mb-1">Status</div>
                  <div className="text-xl font-semibold text-blue-900">
                    {status.status === 'active' ? 'Active' : 'Idle'}
                  </div>
                </div>
                <div className="bg-white rounded-lg p-4 border border-blue-200">
                  <div className="text-sm text-gray-600 mb-1">Monitoring</div>
                  <div className="text-xl font-semibold text-green-600">
                    {autoRefresh ? '🔄 Live' : '⏸️ Paused'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Event List */}
          <div className="border rounded-lg p-4 bg-white">
            <h3 className="font-semibold text-lg text-gray-800 mb-4">
              Received Events ({events.length})
            </h3>
            {events.length > 0 ? (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {events.map((event) => (
                  <div
                    key={event.id}
                    className={`border rounded-lg p-3 ${getEventTypeColor(event.type)}`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 rounded text-xs font-semibold bg-white">
                          {event.type}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                    <div className="text-xs font-mono bg-white/50 rounded p-2 overflow-x-auto">
                      <pre className="whitespace-pre-wrap break-words">
                        {JSON.stringify(event.data, null, 2)}
                      </pre>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <div className="text-lg mb-2">No events received yet</div>
                <div className="text-sm mb-4">Events will appear here when:</div>
                <ul className="text-sm text-left max-w-md mx-auto space-y-1 list-disc list-inside">
                  <li>Embedding jobs are running</li>
                  <li>Tasks are submitted, completed, or fail</li>
                  <li>WebSocket messages are received from the backend</li>
                  <li>Connection status changes</li>
                </ul>
                <div className="text-xs text-gray-400 mt-4">
                  Check the browser console (F12) for debug logs if events should be appearing
                </div>
              </div>
            )}
          </div>

          {/* Connection List */}
          {status && status.connections && status.connections.length > 0 && (
            <div className="border rounded-lg p-4 bg-white">
              <h3 className="font-semibold text-lg text-gray-800 mb-4">
                Active Connections ({status.connections.length})
              </h3>
              <div className="space-y-3">
                {status.connections.map((connection, idx) => (
                  <div
                    key={idx}
                    className="border rounded-lg p-4 bg-gradient-to-r from-gray-50 to-blue-50 border-gray-200 hover:border-blue-300 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${
                          connection.connection_duration_seconds > 300
                            ? 'bg-green-500'
                            : connection.connection_duration_seconds > 60
                            ? 'bg-yellow-500'
                            : 'bg-blue-500'
                        } animate-pulse`}></div>
                        <div className="font-semibold text-gray-800">
                          Connection #{idx + 1}
                        </div>
                      </div>
                      <div className="text-sm text-gray-500">
                        {formatDuration(connection.connection_duration_seconds)} active
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Connected At</div>
                        <div className="font-mono text-xs text-gray-800">
                          {new Date(connection.connected_at * 1000).toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Duration</div>
                        <div className="font-semibold text-gray-800">
                          {formatDuration(connection.connection_duration_seconds)}
                        </div>
                      </div>
                      {connection.client_host && (
                        <div>
                          <div className="text-xs text-gray-500 mb-1">Client Host</div>
                          <div className="font-mono text-sm text-gray-800">
                            {connection.client_host}
                          </div>
                        </div>
                      )}
                      {connection.client_port && (
                        <div>
                          <div className="text-xs text-gray-500 mb-1">Client Port</div>
                          <div className="font-mono text-sm text-gray-800">
                            {connection.client_port}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!status && (
            <div className="flex items-center justify-center h-64">
              <div className="text-gray-500">Loading WebSocket status...</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
