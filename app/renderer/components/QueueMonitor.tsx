import React, { useState, useEffect, useRef } from 'react';

interface QueueStatus {
  queue_size?: number;
  queue_maxsize?: number;
  queue_usage_percent?: number;
  num_workers?: number;
  workers?: Array<{ worker_id: string; state: string; [key: string]: any }>;
  worker_batch_size?: number;
  processing?: number;
  completed?: number;
  failed?: number;
  [key: string]: any; // Allow additional fields
}

interface QueueDataPoint {
  timestamp: number;
  queueSize: number;
  processing: number;
  completed: number;
  failed: number;
}

export const QueueMonitor: React.FC = () => {
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [history, setHistory] = useState<QueueDataPoint[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const fetchQueueStatus = async () => {
    try {
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI) {
        setError('electronAPI not available');
        return;
      }

      const response = await electronAPI.utils.invoke('queue:status');
      
      if (response?.success) {
        const queueStatus = response.data;
        setStatus(queueStatus);
        setError(null);
        setLastUpdate(new Date());

        // Add to history
        const dataPoint: QueueDataPoint = {
          timestamp: Date.now(),
          queueSize: queueStatus.queue_size || 0,
          processing: queueStatus.processing || (Array.isArray(queueStatus.workers) 
            ? queueStatus.workers.filter((w: any) => w.state === 'working' || w.state === 'processing').length 
            : 0),
          completed: queueStatus.completed || 0,
          failed: queueStatus.failed || 0,
        };
        
        setHistory((prev) => {
          const newHistory = [...prev, dataPoint];
          // Keep last 100 data points (about 3-5 minutes at 2s intervals)
          return newHistory.slice(-100);
        });
      } else {
        setError(response?.error || 'Failed to fetch queue status');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch queue data');
    }
  };

  useEffect(() => {
    fetchQueueStatus();
    
    if (autoRefresh) {
      const interval = setInterval(fetchQueueStatus, 2000); // Refresh every 2 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  // Draw graph
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || history.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size based on container
    const container = canvas.parentElement;
    if (container) {
      const rect = container.getBoundingClientRect();
      canvas.width = Math.max(800, rect.width - 32); // Account for padding
      canvas.height = 300;
    }

    const width = canvas.width;
    const height = canvas.height;
    const padding = 40;
    const graphWidth = width - padding * 2;
    const graphHeight = height - padding * 2;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw background
    ctx.fillStyle = '#f9fafb';
    ctx.fillRect(0, 0, width, height);

    // Find max values for scaling
    const maxQueueSize = Math.max(
      ...history.map((d) => d.queueSize),
      status?.max_queue_size || 10,
      1
    );
    const maxProcessing = Math.max(
      ...history.map((d) => d.processing),
      1
    );
    const maxValue = Math.max(maxQueueSize, maxProcessing, 1);

    // Draw grid
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = padding + (graphHeight / 5) * i;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    // Draw axes
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();

    // Draw labels
    ctx.fillStyle = '#6b7280';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
      const value = Math.round((maxValue / 5) * (5 - i));
      const y = padding + (graphHeight / 5) * i;
      ctx.fillText(value.toString(), padding - 10, y + 4);
    }

    // Draw queue size line
    if (history.length > 1) {
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      history.forEach((point, index) => {
        const x = padding + (graphWidth / (history.length - 1)) * index;
        const y = height - padding - (point.queueSize / maxValue) * graphHeight;
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();

      // Fill area under queue size
      ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
      ctx.beginPath();
      ctx.moveTo(padding, height - padding);
      history.forEach((point, index) => {
        const x = padding + (graphWidth / (history.length - 1)) * index;
        const y = height - padding - (point.queueSize / maxValue) * graphHeight;
        ctx.lineTo(x, y);
      });
      ctx.lineTo(width - padding, height - padding);
      ctx.closePath();
      ctx.fill();
    }

    // Draw processing line
    if (history.length > 1) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      history.forEach((point, index) => {
        const x = padding + (graphWidth / (history.length - 1)) * index;
        const y = height - padding - (point.processing / maxValue) * graphHeight;
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
    }

    // Draw legend
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    
    // Queue size legend
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(width - 150, 20, 15, 2);
    ctx.fillStyle = '#374151';
    ctx.fillText('Queue Size', width - 130, 25);

    // Processing legend
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(width - 150, 40, 15, 2);
    ctx.fillStyle = '#374151';
    ctx.fillText('Processing', width - 130, 45);
  }, [history, status]);

  const getQueuePercentage = () => {
    if (!status) return 0;
    // Use queue_usage_percent if available, otherwise calculate
    if (status.queue_usage_percent !== undefined) {
      return status.queue_usage_percent;
    }
    if (status.queue_maxsize) {
      const current = status.queue_size || 0;
      return Math.min((current / status.queue_maxsize) * 100, 100);
    }
    return 0;
  };

  const getQueueColor = () => {
    const percentage = getQueuePercentage();
    if (percentage >= 90) return 'bg-red-500';
    if (percentage >= 70) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  if (error && !status) {
    return (
      <div className="p-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">Error: {error}</p>
          <button
            onClick={fetchQueueStatus}
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
          <h2 className="text-lg font-semibold text-gray-800">Queue Monitor</h2>
          <div className="flex items-center gap-4">
            {lastUpdate && (
              <span className="text-sm text-gray-500">
                Last update: {lastUpdate.toLocaleTimeString()}
              </span>
            )}
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
              onClick={fetchQueueStatus}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {status ? (
          <>
            {/* Queue Size Card */}
            <div className="border rounded-lg p-6 bg-white">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-800">Queue Size</h3>
                <span className="text-2xl font-bold text-gray-900">
                  {status.queue_size || 0}
                  {status.queue_maxsize && (
                    <span className="text-sm font-normal text-gray-500 ml-2">
                      / {status.queue_maxsize}
                    </span>
                  )}
                </span>
              </div>
              {status.queue_usage_percent !== undefined && (
                <div className="text-sm text-gray-600 mb-2">
                  Usage: {status.queue_usage_percent.toFixed(2)}%
                </div>
              )}
              
              {/* Progress Bar */}
              {status.queue_maxsize && (
                <div className="w-full bg-gray-200 rounded-full h-6 mb-2">
                  <div
                    className={`${getQueueColor()} h-6 rounded-full transition-all duration-300 flex items-center justify-center`}
                    style={{ width: `${getQueuePercentage()}%` }}
                  >
                    {getQueuePercentage() > 10 && (
                      <span className="text-white text-xs font-semibold">
                        {Math.round(getQueuePercentage())}%
                      </span>
                    )}
                  </div>
                </div>
              )}
              
              {error && (
                <div className="text-sm text-red-600 mt-2">{error}</div>
              )}
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="border rounded-lg p-4 bg-blue-50 border-blue-200">
                <div className="text-sm text-blue-600 font-medium mb-1">Processing</div>
                <div className="text-2xl font-bold text-blue-900">
                  {status.processing !== undefined 
                    ? status.processing 
                    : (Array.isArray(status.workers) 
                        ? status.workers.filter((w: any) => w.state === 'working' || w.state === 'processing').length 
                        : 0)}
                </div>
              </div>
              
              <div className="border rounded-lg p-4 bg-green-50 border-green-200">
                <div className="text-sm text-green-600 font-medium mb-1">Completed</div>
                <div className="text-2xl font-bold text-green-900">
                  {status.completed || 0}
                </div>
              </div>
              
              <div className="border rounded-lg p-4 bg-red-50 border-red-200">
                <div className="text-sm text-red-600 font-medium mb-1">Failed</div>
                <div className="text-2xl font-bold text-red-900">
                  {status.failed || 0}
                </div>
              </div>
              
              <div className="border rounded-lg p-4 bg-purple-50 border-purple-200">
                <div className="text-sm text-purple-600 font-medium mb-1">Workers</div>
                <div className="text-2xl font-bold text-purple-900">
                  {status.num_workers !== undefined 
                    ? status.num_workers 
                    : (Array.isArray(status.workers) ? status.workers.length : 0)}
                </div>
                {status.worker_batch_size && (
                  <div className="text-xs text-purple-500 mt-1">
                    Batch: {status.worker_batch_size}
                  </div>
                )}
              </div>
            </div>

            {/* Workers Detail */}
            {Array.isArray(status.workers) && status.workers.length > 0 && (
              <div className="border rounded-lg p-4 bg-white">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">
                  Worker Status ({status.workers.length} workers)
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  {status.workers.map((worker: any, index: number) => (
                    <div
                      key={worker.worker_id || index}
                      className={`border rounded-lg p-3 ${
                        worker.state === 'idle' || worker.state === 'ready'
                          ? 'bg-green-50 border-green-200'
                          : worker.state === 'working' || worker.state === 'processing' || worker.state === 'busy'
                          ? 'bg-yellow-50 border-yellow-200'
                          : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-700">
                          {worker.worker_id || `Worker ${index + 1}`}
                        </span>
                        <span
                          className={`px-2 py-1 rounded text-xs font-semibold ${
                            worker.state === 'idle' || worker.state === 'ready'
                              ? 'bg-green-600 text-white'
                              : worker.state === 'working' || worker.state === 'processing' || worker.state === 'busy'
                              ? 'bg-yellow-600 text-white'
                              : 'bg-gray-600 text-white'
                          }`}
                        >
                          {worker.state || 'unknown'}
                        </span>
                      </div>
                      {worker.task_id && (
                        <div className="text-xs text-gray-500 font-mono mt-1">
                          Task: {worker.task_id.substring(0, 12)}...
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Graph */}
            <div className="border rounded-lg p-4 bg-white">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Queue Size Over Time</h3>
              <div className="w-full overflow-x-auto">
                <canvas
                  ref={canvasRef}
                  width={800}
                  height={300}
                  className="border border-gray-200 rounded"
                  style={{ maxWidth: '100%', height: 'auto' }}
                />
              </div>
              {history.length === 0 && (
                <div className="text-center text-gray-400 py-8">
                  No data yet. Waiting for queue updates...
                </div>
              )}
            </div>

            {/* Raw Status (for debugging) */}
            <details className="border rounded-lg p-4 bg-gray-50">
              <summary className="cursor-pointer text-sm font-semibold text-gray-700">
                Raw Queue Status (Debug)
              </summary>
              <pre className="mt-2 text-xs bg-white p-3 rounded border border-gray-200 overflow-auto">
                {JSON.stringify(status, null, 2)}
              </pre>
            </details>
          </>
        ) : (
          <div className="text-gray-500 text-center py-8">
            Loading queue status...
          </div>
        )}
      </div>
    </div>
  );
};

