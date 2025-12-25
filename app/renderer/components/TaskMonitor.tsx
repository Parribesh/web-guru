import React, { useState, useEffect } from 'react';

interface BatchStats {
  batch_id: string;
  batch_index?: number;
  batch_size?: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  chunks_count: number;
  tasks_count: number;
  completed_count: number;
  failed_count: number;
  created_at?: number;
  start_time?: number;
  end_time?: number;
  duration?: number;
  execution_time?: number;
  worker_id?: string;
  throughput_chunks_per_sec?: number;
}

interface JobStats {
  job_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at?: number;
  start_time?: number;
  end_time?: number;
  duration?: number;
  execution_time_sec?: number;
  total_chunks: number;
  completed_chunks: number;
  failed_chunks: number;
  pending_chunks?: number;
  total_batches: number;
  completed_batches?: number;
  failed_batches?: number;
  processing_batches?: number;
  pending_batches?: number;
  avg_batch_size?: number;
  min_batch_size?: number;
  max_batch_size?: number;
  success_rate?: number;
  overall_throughput_chunks_per_sec?: number;
  avg_batch_execution_time_sec?: number;
  min_batch_execution_time_sec?: number;
  max_batch_execution_time_sec?: number;
  // Individual batch metrics (ordered by submission)
  batches: BatchStats[];
  // Batch metrics dictionary keyed by batch_id for direct lookup
  batch_metrics?: { [batch_id: string]: BatchStats };
}

export const TaskMonitor: React.FC = () => {
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [jobStats, setJobStats] = useState<JobStats | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const pollIntervalRef = React.useRef<NodeJS.Timeout | null>(null);

  // Load persisted jobId from localStorage on mount
  useEffect(() => {
    const storedJobId = localStorage.getItem('task-monitor:lastJobId');
    if (storedJobId) {
      setCurrentJobId(storedJobId);
    }
  }, []);

  // Fetch job stats via HTTP (fallback)
  const fetchJobStats = async () => {
    if (!currentJobId) return;

    try {
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI) {
        setError('electronAPI not available');
        return;
      }

      const response = await electronAPI.utils.invoke('embedding:job-stats', currentJobId);
      
      if (response?.success) {
        setJobStats(response.data);
        setError(null);
        setLastUpdate(new Date());
      } else {
        setError(response?.error || 'Failed to fetch job stats');
      }
    } catch (err: any) {
      console.error('[TaskMonitor] Error fetching job stats:', err);
      setError(err.message || 'Unknown error');
    }
  };

  // Listen for job_status_update events via IPC (from global WebSocket)
  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.on) return;

    const handleEmbeddingEvent = (_event: any, eventData: any) => {
      // Process job_status_update events from global WebSocket
      // Backend sends: { type: "job_status_update", payload: { job_id: "...", status: {...} } }
      if (eventData.type === 'job_status_update' && eventData.payload?.status) {
        const jobStatusData = eventData.payload.status;
        const eventJobId = eventData.payload.job_id;
        
        // Only update if this is for the current job (or if we don't have a current job yet, accept it)
        if (!currentJobId || jobStatusData.job_id === currentJobId || eventJobId === currentJobId) {
          console.log('[TaskMonitor] Received job_status_update via IPC:', jobStatusData);
          setJobStats(jobStatusData as JobStats);
          setLastUpdate(new Date());
          setError(null);
          setWsConnected(true); // Mark as connected since we're receiving updates
          
          // Auto-set currentJobId if not set
          if (!currentJobId && eventJobId) {
            setCurrentJobId(eventJobId);
            localStorage.setItem('task-monitor:lastJobId', eventJobId);
          }
        }
      } else if (eventData.type === 'websocket_connected') {
        setWsConnected(true);
      } else if (eventData.type === 'websocket_closed' || eventData.type === 'websocket_error') {
        setWsConnected(false);
      }
    };

    electronAPI.on('embedding-service:event', handleEmbeddingEvent);

    return () => {
      if (electronAPI?.off) {
        electronAPI.off('embedding-service:event', handleEmbeddingEvent);
      }
    };
  }, [currentJobId, autoRefresh]);

  // Listen for job_started events to auto-detect job ID (same pattern as EmbeddingStats)
  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.on) return;

    const handleEmbeddingEvent = (_event: any, eventData: any) => {
      // Listen for job_started events
      if (eventData.type === 'job_started' && eventData.jobId) {
        console.log('[TaskMonitor] Detected job ID from job_started event:', eventData.jobId);
        setCurrentJobId(eventData.jobId);
        localStorage.setItem('task-monitor:lastJobId', eventData.jobId);
        return;
      }
      
      // Also check for jobId in websocket_message events (from batch submission response)
      if (eventData.type === 'websocket_message' && eventData.jobId) {
        console.log('[TaskMonitor] Detected job ID from WebSocket message:', eventData.jobId);
        setCurrentJobId(eventData.jobId);
        localStorage.setItem('task-monitor:lastJobId', eventData.jobId);
      }
    };

    electronAPI.on('embedding-service:event', handleEmbeddingEvent);

    return () => {
      if (electronAPI?.off) {
        electronAPI.off('embedding-service:event', handleEmbeddingEvent);
      }
    };
  }, []);

  // Calculate average metrics from completed batches
  const completedBatches = jobStats?.batches.filter(b => b.status === 'completed') ?? [];
  const avgMetrics = completedBatches.length > 0 ? {
    executionTime: completedBatches.reduce((sum, b) => sum + (b.execution_time ?? (b.duration! / 1000)), 0) / completedBatches.length,
    throughput: completedBatches.filter(b => b.throughput_chunks_per_sec !== undefined)
      .reduce((sum, b) => sum + b.throughput_chunks_per_sec!, 0) / completedBatches.filter(b => b.throughput_chunks_per_sec !== undefined).length,
    batchSize: completedBatches.filter(b => b.batch_size !== undefined)
      .reduce((sum, b) => sum + b.batch_size!, 0) / completedBatches.filter(b => b.batch_size !== undefined).length,
    successRate: completedBatches.reduce((sum, b) => {
      const total = b.tasks_count || b.chunks_count;
      const completed = b.completed_count;
      return sum + (total > 0 ? (completed / total) * 100 : 0);
    }, 0) / completedBatches.length,
  } : null;

  if (error && !jobStats) {
    return (
      <div className="p-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">Error: {error}</p>
          <button
            onClick={fetchJobStats}
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
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-800">Batch Performance Monitor</h2>
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
              onClick={fetchJobStats}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
            >
              Refresh
            </button>
            {lastUpdate && (
              <span className="text-xs text-gray-500">
                Last update: {lastUpdate.toLocaleTimeString()}
              </span>
            )}
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-gray-400'}`} title={wsConnected ? 'WebSocket connected' : 'WebSocket disconnected'} />
              <span className="text-xs text-gray-500">
                {wsConnected ? 'WS' : 'HTTP'}
              </span>
            </div>
          </div>
        </div>
        {/* Job ID Display/Input */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 font-medium">Job ID:</label>
          <input
            type="text"
            value={currentJobId || ''}
            onChange={(e) => {
              const jobId = e.target.value.trim();
              setCurrentJobId(jobId || null);
              if (jobId) {
                localStorage.setItem('task-monitor:lastJobId', jobId);
              } else {
                localStorage.removeItem('task-monitor:lastJobId');
              }
            }}
            placeholder="Auto-detected or enter manually..."
            className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
          />
          {currentJobId && (
            <button
              onClick={() => {
                setCurrentJobId(null);
                setJobStats(null);
                localStorage.removeItem('task-monitor:lastJobId');
              }}
              className="px-2 py-1 text-xs bg-gray-400 text-white rounded hover:bg-gray-500"
              title="Clear job ID"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {!currentJobId ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="text-gray-500 mb-2">Waiting for embedding job to start...</div>
              <div className="text-sm text-gray-400">Job ID will be auto-detected when a batch is submitted</div>
            </div>
          </div>
        ) : !jobStats ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-500">Loading job statistics...</div>
          </div>
        ) : (
          <>
            {/* Job Overview */}
            <div className="border rounded-lg p-4 bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-lg text-gray-800">Job Overview</h3>
                  <div className="text-xs text-gray-500 font-mono mt-1">Job ID: {jobStats.job_id}</div>
                </div>
                <div className={`px-3 py-1 rounded text-sm font-semibold ${
                  jobStats.status === 'completed' ? 'bg-green-600 text-white' :
                  jobStats.status === 'processing' ? 'bg-blue-600 text-white' :
                  jobStats.status === 'failed' ? 'bg-red-600 text-white' :
                  'bg-gray-600 text-white'
                }`}>
                  {jobStats.status.toUpperCase()}
                </div>
              </div>

              {/* Job Execution Time */}
              {(jobStats.created_at || jobStats.start_time || jobStats.end_time || jobStats.duration !== undefined || jobStats.execution_time_sec !== undefined) && (
                <div className="mb-4 pb-4 border-b border-blue-300">
                  <div className="text-xs font-semibold text-gray-700 mb-2">Job Execution Time</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    {jobStats.created_at && (
                      <div>
                        <span className="text-gray-500">Created:</span>{' '}
                        <span className="font-mono">{new Date(jobStats.created_at).toLocaleTimeString()}</span>
                      </div>
                    )}
                    {jobStats.start_time && (
                      <div>
                        <span className="text-gray-500">Started:</span>{' '}
                        <span className="font-mono">{new Date(jobStats.start_time).toLocaleTimeString()}</span>
                      </div>
                    )}
                    {jobStats.end_time && (
                      <div>
                        <span className="text-gray-500">Ended:</span>{' '}
                        <span className="font-mono">{new Date(jobStats.end_time).toLocaleTimeString()}</span>
                      </div>
                    )}
                    {(jobStats.execution_time_sec !== undefined || jobStats.duration !== undefined) && (
                      <div>
                        <span className="text-gray-500">Duration:</span>{' '}
                        <span className="font-semibold text-blue-700">
                          {jobStats.execution_time_sec !== undefined 
                            ? `${jobStats.execution_time_sec.toFixed(3)}s`
                            : jobStats.duration !== undefined 
                              ? `${(jobStats.duration / 1000).toFixed(3)}s`
                              : 'N/A'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-gray-500 mb-1">Total Batches</div>
                  <div className="text-2xl font-bold text-gray-800">{jobStats.total_batches}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {jobStats.completed_batches ?? 0} completed, {jobStats.processing_batches ?? 0} processing
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">Total Chunks</div>
                  <div className="text-2xl font-bold text-gray-800">{jobStats.total_chunks}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {jobStats.completed_chunks} completed, {jobStats.failed_chunks} failed
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">Success Rate</div>
                  <div className={`text-2xl font-bold ${
                    jobStats.success_rate !== undefined && jobStats.success_rate >= 95
                      ? 'text-green-600'
                      : jobStats.success_rate !== undefined && jobStats.success_rate >= 80
                      ? 'text-yellow-600'
                      : 'text-red-600'
                  }`}>
                    {jobStats.success_rate !== undefined ? jobStats.success_rate.toFixed(1) + '%' : 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">Overall Throughput</div>
                  <div className="text-2xl font-bold text-purple-600">
                    {jobStats.overall_throughput_chunks_per_sec !== undefined
                      ? jobStats.overall_throughput_chunks_per_sec.toFixed(1)
                      : 'N/A'}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">chunks/second</div>
                </div>
              </div>
            </div>

            {/* Average Batch Metrics */}
            {avgMetrics && completedBatches.length > 0 && (
              <div className="border rounded-lg p-4 bg-white">
                <h3 className="font-semibold text-lg text-gray-800 mb-4">Average Batch Metrics ({completedBatches.length} completed batches)</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="border rounded p-3 bg-blue-50 border-blue-200">
                    <div className="text-xs text-gray-600 mb-1">Avg Execution Time</div>
                    <div className="text-xl font-bold text-blue-900">{avgMetrics.executionTime.toFixed(3)}s</div>
                    {jobStats.avg_batch_execution_time_sec !== undefined && (
                      <div className="text-xs text-gray-500 mt-1">
                        Range: {jobStats.min_batch_execution_time_sec?.toFixed(3)}s - {jobStats.max_batch_execution_time_sec?.toFixed(3)}s
                      </div>
                    )}
                  </div>
                  <div className="border rounded p-3 bg-green-50 border-green-200">
                    <div className="text-xs text-gray-600 mb-1">Avg Throughput</div>
                    <div className="text-xl font-bold text-green-900">
                      {!isNaN(avgMetrics.throughput) ? avgMetrics.throughput.toFixed(2) : 'N/A'}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">chunks/second</div>
                  </div>
                  <div className="border rounded p-3 bg-purple-50 border-purple-200">
                    <div className="text-xs text-gray-600 mb-1">Avg Batch Size</div>
                    <div className="text-xl font-bold text-purple-900">
                      {!isNaN(avgMetrics.batchSize) ? avgMetrics.batchSize.toFixed(1) : 'N/A'}
                    </div>
                    {jobStats.avg_batch_size !== undefined && (
                      <div className="text-xs text-gray-500 mt-1">
                        Range: {jobStats.min_batch_size} - {jobStats.max_batch_size}
                      </div>
                    )}
                  </div>
                  <div className="border rounded p-3 bg-orange-50 border-orange-200">
                    <div className="text-xs text-gray-600 mb-1">Avg Success Rate</div>
                    <div className="text-xl font-bold text-orange-900">{avgMetrics.successRate.toFixed(1)}%</div>
                    <div className="text-xs text-gray-500 mt-1">Per batch completion</div>
                  </div>
                </div>
              </div>
            )}

            {/* Batch Details Table */}
            {jobStats.batches && jobStats.batches.length > 0 && (
              <div className="border rounded-lg p-4 bg-white">
                <h3 className="font-semibold text-lg text-gray-800 mb-4">Batch Details ({jobStats.batches.length} total)</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="text-left py-2 px-3 text-gray-600 font-semibold">#</th>
                        <th className="text-left py-2 px-3 text-gray-600 font-semibold">Status</th>
                        <th className="text-right py-2 px-3 text-gray-600 font-semibold">Size</th>
                        <th className="text-right py-2 px-3 text-gray-600 font-semibold">Chunks</th>
                        <th className="text-right py-2 px-3 text-gray-600 font-semibold">Completed</th>
                        <th className="text-right py-2 px-3 text-gray-600 font-semibold">Failed</th>
                        <th className="text-right py-2 px-3 text-gray-600 font-semibold">Time</th>
                        <th className="text-right py-2 px-3 text-gray-600 font-semibold">Throughput</th>
                        {jobStats.batches.some(b => b.worker_id) && (
                          <th className="text-left py-2 px-3 text-gray-600 font-semibold">Worker</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {jobStats.batches
                        .sort((a, b) => (a.batch_index ?? 0) - (b.batch_index ?? 0))
                        .map((batch) => {
                          const executionTime = batch.execution_time ?? (batch.duration ? batch.duration / 1000 : undefined);
                          const successRate = batch.tasks_count > 0 ? (batch.completed_count / batch.tasks_count) * 100 : 0;
                          
                          return (
                            <tr
                              key={batch.batch_id}
                              className={`border-b border-gray-100 hover:bg-gray-50 ${
                                batch.status === 'completed' ? 'bg-green-50/30' :
                                batch.status === 'processing' ? 'bg-blue-50/30' :
                                batch.status === 'failed' ? 'bg-red-50/30' :
                                ''
                              }`}
                            >
                              <td className="py-2 px-3 font-medium">
                                {(batch.batch_index ?? 0) + 1}
                              </td>
                              <td className="py-2 px-3">
                                <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                                  batch.status === 'completed' ? 'bg-green-100 text-green-800' :
                                  batch.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                                  batch.status === 'failed' ? 'bg-red-100 text-red-800' :
                                  'bg-gray-100 text-gray-800'
                                }`}>
                                  {batch.status}
                                </span>
                              </td>
                              <td className="text-right py-2 px-3 font-semibold">
                                {batch.batch_size ?? batch.chunks_count}
                              </td>
                              <td className="text-right py-2 px-3">
                                {batch.chunks_count}
                              </td>
                              <td className="text-right py-2 px-3 font-semibold text-green-600">
                                {batch.completed_count}/{batch.tasks_count || batch.chunks_count}
                              </td>
                              <td className="text-right py-2 px-3">
                                {batch.failed_count > 0 ? (
                                  <span className="font-semibold text-red-600">{batch.failed_count}</span>
                                ) : (
                                  <span className="text-gray-400">0</span>
                                )}
                              </td>
                              <td className="text-right py-2 px-3">
                                {executionTime !== undefined ? (
                                  <span className={`font-semibold ${
                                    avgMetrics && executionTime < avgMetrics.executionTime * 0.8
                                      ? 'text-green-600'
                                      : avgMetrics && executionTime > avgMetrics.executionTime * 1.2
                                      ? 'text-orange-600'
                                      : 'text-gray-800'
                                  }`}>
                                    {executionTime.toFixed(3)}s
                                  </span>
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )}
                              </td>
                              <td className="text-right py-2 px-3">
                                {batch.throughput_chunks_per_sec !== undefined ? (
                                  <span className="font-semibold text-blue-600">
                                    {batch.throughput_chunks_per_sec.toFixed(2)}
                                  </span>
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )}
                              </td>
                              {jobStats.batches.some(b => b.worker_id) && (
                                <td className="py-2 px-3 text-xs font-mono text-gray-600">
                                  {batch.worker_id ? batch.worker_id.substring(0, 8) : '-'}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

