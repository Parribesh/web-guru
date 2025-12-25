import React, { useState, useEffect, useRef } from 'react';

interface EmbeddingConfig {
  batchSize: number;
  timeout: number;
  baseUrl: string;
  socketUrl?: string;
}

interface CurrentProgress {
  current: number;
  total: number;
  message: string;
  percentage: number;
  jobId?: string;
  summary?: {
    totalChunks: number;
    totalBatches: number;
    totalTime: number;
    avgBatchTime: number;
  };
}

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
  // Timestamps (all in milliseconds)
  created_at?: number;
  start_time?: number;
  end_time?: number;
  duration?: number;
  execution_time_sec?: number;
  // Task/Chunk counts
  total_chunks: number;
  completed_chunks: number;
  failed_chunks: number;
  pending_chunks?: number;
  // Batch counts
  total_batches: number;
  completed_batches?: number;
  failed_batches?: number;
  processing_batches?: number;
  pending_batches?: number;
  // Batch size statistics
  avg_batch_size?: number;
  min_batch_size?: number;
  max_batch_size?: number;
  // Performance metrics
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

interface ExecutionHistory {
  timestamp: number;
  totalChunks: number;
  totalBatches: number;
  totalTime: number;
  avgBatchTime: number;
  successRate: number;
}

interface TaskEvent {
  type: 'submitted' | 'completed' | 'error';
  taskId: string;
  chunkId: string;
  timestamp: number;
  error?: string;
}

export const EmbeddingStats: React.FC = () => {
  const [config, setConfig] = useState<EmbeddingConfig | null>(null);
  const [currentProgress, setCurrentProgress] = useState<CurrentProgress | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [executionHistory, setExecutionHistory] = useState<ExecutionHistory[]>([]);
  const [taskEvents, setTaskEvents] = useState<TaskEvent[]>([]);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [jobStats, setJobStats] = useState<JobStats | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const pollIntervalRef = React.useRef<NodeJS.Timeout | null>(null);
  
  // Execution rate tracking
  const [completedTasks, setCompletedTasks] = useState<Array<{ timestamp: number }>>([]);
  const [executionRate, setExecutionRate] = useState<number>(0);
  const rateCalculationWindow = 10000; // Calculate rate over last 10 seconds
  const rateUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate execution rate
  useEffect(() => {
    const updateRate = () => {
      const now = Date.now();
      const windowStart = now - rateCalculationWindow;
      
      const recentCompletions = completedTasks.filter(
        task => task.timestamp >= windowStart
      );
      
      if (recentCompletions.length > 0) {
        const timeSpan = (now - recentCompletions[0].timestamp) / 1000;
        const rate = timeSpan > 0 ? recentCompletions.length / timeSpan : 0;
        setExecutionRate(rate);
      } else {
        setExecutionRate(0);
      }
    };

    rateUpdateIntervalRef.current = setInterval(updateRate, 1000);
    updateRate();

    return () => {
      if (rateUpdateIntervalRef.current) {
        clearInterval(rateUpdateIntervalRef.current);
      }
    };
  }, [completedTasks, rateCalculationWindow]);

  const fetchConfig = async () => {
    try {
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI) {
        setError('electronAPI not available');
        return;
      }

      const response = await electronAPI.utils.invoke('embedding:stats');
      
      if (response?.success) {
        setConfig(response.data.config);
        setError(null);
      } else {
        setError(response?.error || 'Failed to fetch embedding config');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch embedding config');
    }
  };

  // Load persisted jobId from localStorage on mount
  useEffect(() => {
    const storedJobId = localStorage.getItem('embedding-stats:lastJobId');
    if (storedJobId) {
      setCurrentJobId(storedJobId);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    
    if (autoRefresh) {
      const interval = setInterval(fetchConfig, 5000); // Refresh config every 5 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);


  // Fetch job stats via HTTP (fallback)
  const fetchJobStats = async () => {
    if (!currentJobId) return;

    try {
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI) return;

      const response = await electronAPI.utils.invoke('embedding:job-stats', currentJobId);
      if (response?.success) {
        setJobStats(response.data);
      }
    } catch (err: any) {
      console.error('[EmbeddingStats] Failed to fetch job stats:', err);
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
          console.log('[EmbeddingStats] Received job_status_update via IPC:', jobStatusData);
          setJobStats(jobStatusData as JobStats);
          setIsActive(jobStatusData.status === 'processing' || jobStatusData.status === 'pending');
          setWsConnected(true); // Mark as connected since we're receiving updates
          
          // Auto-set currentJobId if not set
          if (!currentJobId && eventJobId) {
            setCurrentJobId(eventJobId);
            localStorage.setItem('embedding-stats:lastJobId', eventJobId);
          }
        }
      } else if (eventData.type === 'websocket_connected') {
        setWsConnected(true);
      } else if (eventData.type === 'websocket_closed' || eventData.type === 'websocket_error') {
        setWsConnected(false);
        // Fall back to HTTP polling if needed
        if (!pollIntervalRef.current && autoRefresh) {
          fetchJobStats();
          pollIntervalRef.current = setInterval(fetchJobStats, 2000);
        }
      }
    };

    electronAPI.on('embedding-service:event', handleEmbeddingEvent);

    return () => {
      if (electronAPI?.off) {
        electronAPI.off('embedding-service:event', handleEmbeddingEvent);
      }
    };
  }, [currentJobId, autoRefresh]);

  // Listen for job_started events to auto-detect job ID
  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.on) return;

    const handleEmbeddingEvent = (_event: any, eventData: any) => {
      // Listen for job_started events
      if (eventData.type === 'job_started' && eventData.jobId) {
        console.log('[EmbeddingStats] Detected job ID from job_started event:', eventData.jobId);
        setCurrentJobId(eventData.jobId);
        localStorage.setItem('embedding-stats:lastJobId', eventData.jobId);
        return;
      }
      
      // Also check for jobId in websocket_message events (from batch submission response)
      if (eventData.type === 'websocket_message' && eventData.jobId) {
        console.log('[EmbeddingStats] Detected job ID from WebSocket message:', eventData.jobId);
        setCurrentJobId(eventData.jobId);
        localStorage.setItem('embedding-stats:lastJobId', eventData.jobId);
      }
    };

    electronAPI.on('embedding-service:event', handleEmbeddingEvent);

    return () => {
      if (electronAPI?.off) {
        electronAPI.off('embedding-service:event', handleEmbeddingEvent);
      }
    };
  }, []);

  // Listen for real-time embedding events
  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.on) return;

    const handleLogEvent = (event: any) => {
      const category = event.category || '';
      const message = event.message || '';
      const level = event.level || '';

      // Track embedding service events
      if (category === 'Embedding Service' || category === 'RAG Cache' || category === 'Embeddings') {
        // Track progress events
        if (event.progress) {
          const progress = event.progress;
          const percentage = progress.percentage ?? Math.round((progress.current / progress.total) * 100);
          
          setIsActive(true);
          
          // Track completion when progress increases
          setCurrentProgress(prev => {
            if (prev && progress.current > prev.current) {
              setCompletedTasks(prevTasks => {
                const newTasks = [...prevTasks, { timestamp: Date.now() }];
                const oneMinuteAgo = Date.now() - 60000;
                return newTasks.filter(task => task.timestamp >= oneMinuteAgo);
              });
            }
            
            return {
              current: progress.current,
              total: progress.total,
              message: message,
              percentage: percentage,
            };
          });
          
                          // Extract jobId and summary from completion message
                          // Note: jobId detection is now handled via embedding-service:event (job_started, websocket_message)
                          // This is kept for backward compatibility with log messages
                          if (message.includes('jobId:')) {
                            const jobIdMatch = message.match(/jobId:\s*([a-f0-9-]+)/i);
                            if (jobIdMatch) {
                              const extractedJobId = jobIdMatch[1];
                              setCurrentJobId(extractedJobId);
                              setCurrentProgress(prev => prev ? { ...prev, jobId: extractedJobId } : null);
                            }
                          }
          
          if (percentage === 100 && message.includes('Completed:')) {
            const chunksMatch = message.match(/(\d+)\/(\d+)\s+chunks/);
            const batchesMatch = message.match(/(\d+)\s+batches/);
            const totalTimeMatch = message.match(/([\d.]+)s\s+total/);
            const avgTimeMatch = message.match(/([\d.]+)s\s+avg\/batch/);
            const jobIdMatch = message.match(/jobId:\s*([a-f0-9-]+)/i);
            
            if (chunksMatch && batchesMatch && totalTimeMatch && avgTimeMatch) {
              const summary = {
                totalChunks: parseInt(chunksMatch[2]),
                totalBatches: parseInt(batchesMatch[1]),
                totalTime: parseFloat(totalTimeMatch[1]) * 1000,
                avgBatchTime: parseFloat(avgTimeMatch[1]) * 1000,
              };
              
              const extractedJobId = jobIdMatch ? jobIdMatch[1] : currentJobId;
              setCurrentJobId(extractedJobId);
              setCurrentProgress(prev => prev ? { ...prev, summary, jobId: extractedJobId } : null);
              
              // Add to execution history
              const execution: ExecutionHistory = {
                timestamp: Date.now(),
                totalChunks: summary.totalChunks,
                totalBatches: summary.totalBatches,
                totalTime: summary.totalTime,
                avgBatchTime: summary.avgBatchTime,
                successRate: (parseInt(chunksMatch[1]) / parseInt(chunksMatch[2])) * 100,
              };
              
              setExecutionHistory(prev => [execution, ...prev].slice(0, 50));
              
              // Keep jobId for stats viewing, but clear progress after delay
              setTimeout(() => {
                setIsActive(false);
                setCurrentProgress(null);
                setCompletedTasks([]);
                setExecutionRate(0);
                setTaskEvents([]);
                // Don't clear jobId - keep it for stats viewing
              }, 10000); // Increased to 10 seconds to allow viewing stats
            }
          }
        } else if (level === 'info' && message.includes('Starting embedding')) {
          setIsActive(true);
          setCurrentProgress(null);
          setCompletedTasks([]);
          setTaskEvents([]);
        }
      }
    };

    // Listen for embedding service events (task submissions, completions)
    const handleEmbeddingEvent = (_event: any, eventData: any) => {
      if (eventData.type === 'task_submitted') {
        const newEvent: TaskEvent = {
          type: 'submitted',
          taskId: eventData.taskId,
          chunkId: eventData.chunkId,
          timestamp: eventData.timestamp,
        };
        setTaskEvents(prev => [...prev, newEvent].slice(-100)); // Keep last 100 events
      } else if (eventData.type === 'task_complete') {
        const newEvent: TaskEvent = {
          type: 'completed',
          taskId: eventData.taskId,
          chunkId: eventData.chunkId || 'unknown',
          timestamp: eventData.timestamp,
        };
        setTaskEvents(prev => [...prev, newEvent].slice(-100));
      } else if (eventData.type === 'task_error') {
        const newEvent: TaskEvent = {
          type: 'error',
          taskId: eventData.taskId,
          chunkId: eventData.chunkId || 'unknown',
          timestamp: eventData.timestamp,
          error: eventData.error,
        };
        setTaskEvents(prev => [...prev, newEvent].slice(-100));
      } else if (eventData.type === 'job_complete') {
        // Job completed, fetch stats
        setCurrentJobId(eventData.jobId);
        // Persist to localStorage
        localStorage.setItem('embedding-stats:lastJobId', eventData.jobId);
        // Stats will be fetched by the useEffect hook
      }
    };

    electronAPI.on('log:event', handleLogEvent);
    electronAPI.on('embedding-service:event', handleEmbeddingEvent);

    return () => {
      if (electronAPI?.off) {
        electronAPI.off('log:event', handleLogEvent);
        electronAPI.off('embedding-service:event', handleEmbeddingEvent);
      }
    };
  }, []);

  // Calculate aggregated stats from history
  const aggregatedStats = executionHistory.length > 0 ? {
    totalExecutions: executionHistory.length,
    totalChunksProcessed: executionHistory.reduce((sum, e) => sum + e.totalChunks, 0),
    totalBatchesProcessed: executionHistory.reduce((sum, e) => sum + e.totalBatches, 0),
    averageExecutionTime: executionHistory.reduce((sum, e) => sum + e.totalTime, 0) / executionHistory.length,
    averageBatchTime: executionHistory.reduce((sum, e) => sum + e.avgBatchTime, 0) / executionHistory.length,
    averageSuccessRate: executionHistory.reduce((sum, e) => sum + e.successRate, 0) / executionHistory.length,
  } : null;

  // Calculate current batch stats
  const submittedCount = taskEvents.filter(e => e.type === 'submitted').length;
  const completedCount = taskEvents.filter(e => e.type === 'completed').length;
  const errorCount = taskEvents.filter(e => e.type === 'error').length;
  const currentBatchCount = config ? Math.ceil((submittedCount || (currentProgress?.total || 0)) / (config.batchSize || 1)) : 0;

  if (error && !config) {
    return (
      <div className="p-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">Error: {error}</p>
          <button
            onClick={fetchConfig}
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
          <h2 className="text-lg font-semibold text-gray-800">Embedding Statistics</h2>
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
                setTaskEvents([]);
                setExecutionHistory([]);
                setCurrentJobId(null);
                setJobStats(null);
                localStorage.removeItem('embedding-stats:lastJobId');
              }}
              className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm"
            >
              Clear History
            </button>
            <button
              onClick={fetchConfig}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
            >
              Refresh
            </button>
          </div>
        </div>
        {/* Job ID Input */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 font-medium">Monitor Job ID:</label>
          <input
            type="text"
            value={currentJobId || ''}
            onChange={(e) => {
              const jobId = e.target.value.trim();
              setCurrentJobId(jobId || null);
              if (jobId) {
                localStorage.setItem('embedding-stats:lastJobId', jobId);
              } else {
                localStorage.removeItem('embedding-stats:lastJobId');
              }
            }}
            placeholder="Enter job ID to monitor..."
            className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
          />
          {currentJobId && (
            <button
              onClick={() => {
                setCurrentJobId(null);
                setJobStats(null);
                localStorage.removeItem('embedding-stats:lastJobId');
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
        {config ? (
          <>
            {/* Configuration Card */}
            <div className="border rounded-lg p-4 bg-blue-50 border-blue-200">
              <h3 className="font-semibold text-lg text-gray-800 mb-3">Configuration</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-gray-600 mb-1">Batch Size</div>
                  <div className="text-xl font-bold text-blue-900">{config.batchSize}</div>
                  <div className="text-xs text-gray-500 mt-1">chunks per batch</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 mb-1">Timeout</div>
                  <div className="text-xl font-bold text-blue-900">{(config.timeout / 1000).toFixed(0)}s</div>
                  <div className="text-xs text-gray-500 mt-1">per task</div>
                </div>
                <div className="col-span-2">
                  <div className="text-sm text-gray-600 mb-1">Service URL</div>
                  <div className="text-sm font-mono text-blue-900 break-all">{config.baseUrl}</div>
                </div>
                {config.socketUrl && (
                  <div className="col-span-2">
                    <div className="text-sm text-gray-600 mb-1">WebSocket URL</div>
                    <div className="text-sm font-mono text-blue-900 break-all">{config.socketUrl}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Current/Recent Job Stats */}
            {(isActive && currentProgress) || currentJobId ? (
              <div className="border rounded-lg p-4 bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-lg text-gray-800">
                      {isActive ? 'Current Execution' : 'Job Statistics'}
                    </h3>
                    {currentJobId && (
                      <div className="text-xs text-gray-500 font-mono mt-1">
                        Job ID: {currentJobId}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {executionRate > 0 && (
                      <div className="text-sm">
                        <span className="text-gray-600">Rate: </span>
                        <span className={`font-bold ${
                          executionRate >= 10 ? 'text-green-600' : executionRate >= 5 ? 'text-yellow-600' : 'text-orange-600'
                        }`}>
                          {executionRate.toFixed(2)}/sec
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></div>
                      <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-gray-400'}`} title={wsConnected ? 'WebSocket connected' : 'WebSocket disconnected'}></div>
                      <span className="text-xs text-gray-500">
                        {wsConnected ? 'WS' : 'HTTP'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Progress Bar (if active) */}
                {isActive && currentProgress && (
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-700">{currentProgress.message}</span>
                      <span className="text-sm font-semibold text-gray-800">
                        {currentProgress.current}/{currentProgress.total} ({currentProgress.percentage}%)
                      </span>
                    </div>
                    <div className="h-3 bg-blue-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all duration-300 ease-out"
                        style={{ width: `${currentProgress.percentage}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Job Stats from Server */}
                {jobStats && (
                  <div className="mt-3 pt-3 border-t border-blue-300 bg-white rounded p-3 space-y-4">
                    {/* Overview Metrics */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Status</div>
                        <div className={`text-sm font-semibold ${
                          jobStats.status === 'completed' ? 'text-green-600' :
                          jobStats.status === 'processing' ? 'text-blue-600' :
                          jobStats.status === 'failed' ? 'text-red-600' :
                          'text-gray-600'
                        }`}>
                          {jobStats.status.toUpperCase()}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Chunks</div>
                        <div className="text-sm font-bold">
                          {jobStats.completed_chunks}/{jobStats.total_chunks}
                          {jobStats.failed_chunks > 0 && (
                            <span className="text-red-600 ml-1">({jobStats.failed_chunks} failed)</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Batches</div>
                        <div className="text-sm font-bold">{jobStats.total_batches}</div>
                      </div>
                      {jobStats.success_rate !== undefined && (
                        <div>
                          <div className="text-xs text-gray-500 mb-1">Success Rate</div>
                          <div className={`text-sm font-bold ${
                            jobStats.success_rate >= 95 ? 'text-green-600' :
                            jobStats.success_rate >= 80 ? 'text-yellow-600' :
                            'text-red-600'
                          }`}>
                            {jobStats.success_rate.toFixed(1)}%
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Timestamps */}
                    {(jobStats.created_at || jobStats.start_time || jobStats.end_time || jobStats.duration) && (
                      <div className="border-t border-gray-200 pt-3">
                        <div className="text-xs font-semibold text-gray-700 mb-2">Timestamps</div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
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
                          {(jobStats.duration !== undefined || jobStats.execution_time_sec !== undefined) && (
                            <div>
                              <span className="text-gray-500">Duration:</span>{' '}
                              <span className="font-semibold">
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

                    {/* Task/Chunk Counts */}
                    <div className="border-t border-gray-200 pt-3">
                      <div className="text-xs font-semibold text-gray-700 mb-2">Task/Chunk Counts</div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <div>
                          <span className="text-gray-500">Total Chunks:</span>{' '}
                          <span className="font-semibold">{jobStats.total_chunks}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Completed:</span>{' '}
                          <span className="font-semibold text-green-600">{jobStats.completed_chunks}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Failed:</span>{' '}
                          <span className="font-semibold text-red-600">{jobStats.failed_chunks}</span>
                        </div>
                        {jobStats.pending_chunks !== undefined && (
                          <div>
                            <span className="text-gray-500">Pending:</span>{' '}
                            <span className="font-semibold text-yellow-600">{jobStats.pending_chunks}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Batch Counts */}
                    {(jobStats.completed_batches !== undefined || jobStats.failed_batches !== undefined || 
                      jobStats.processing_batches !== undefined || jobStats.pending_batches !== undefined) && (
                      <div className="border-t border-gray-200 pt-3">
                        <div className="text-xs font-semibold text-gray-700 mb-2">Batch Status Counts</div>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                          <div>
                            <span className="text-gray-500">Total:</span>{' '}
                            <span className="font-semibold">{jobStats.total_batches}</span>
                          </div>
                          {jobStats.completed_batches !== undefined && (
                            <div>
                              <span className="text-gray-500">Completed:</span>{' '}
                              <span className="font-semibold text-green-600">{jobStats.completed_batches}</span>
                            </div>
                          )}
                          {jobStats.processing_batches !== undefined && (
                            <div>
                              <span className="text-gray-500">Processing:</span>{' '}
                              <span className="font-semibold text-blue-600">{jobStats.processing_batches}</span>
                            </div>
                          )}
                          {jobStats.pending_batches !== undefined && (
                            <div>
                              <span className="text-gray-500">Pending:</span>{' '}
                              <span className="font-semibold text-yellow-600">{jobStats.pending_batches}</span>
                            </div>
                          )}
                          {jobStats.failed_batches !== undefined && (
                            <div>
                              <span className="text-gray-500">Failed:</span>{' '}
                              <span className="font-semibold text-red-600">{jobStats.failed_batches}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Batch Size Statistics */}
                    {(jobStats.avg_batch_size !== undefined || jobStats.min_batch_size !== undefined || 
                      jobStats.max_batch_size !== undefined) && (
                      <div className="border-t border-gray-200 pt-3">
                        <div className="text-xs font-semibold text-gray-700 mb-2">Batch Size Statistics</div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          {jobStats.avg_batch_size !== undefined && (
                            <div>
                              <span className="text-gray-500">Avg:</span>{' '}
                              <span className="font-semibold">{jobStats.avg_batch_size.toFixed(1)}</span>
                            </div>
                          )}
                          {jobStats.min_batch_size !== undefined && (
                            <div>
                              <span className="text-gray-500">Min:</span>{' '}
                              <span className="font-semibold">{jobStats.min_batch_size}</span>
                            </div>
                          )}
                          {jobStats.max_batch_size !== undefined && (
                            <div>
                              <span className="text-gray-500">Max:</span>{' '}
                              <span className="font-semibold">{jobStats.max_batch_size}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Performance Metrics */}
                    {(jobStats.overall_throughput_chunks_per_sec !== undefined || 
                      jobStats.avg_batch_execution_time_sec !== undefined ||
                      jobStats.min_batch_execution_time_sec !== undefined ||
                      jobStats.max_batch_execution_time_sec !== undefined) && (
                      <div className="border-t border-gray-200 pt-3">
                        <div className="text-xs font-semibold text-gray-700 mb-2">Performance Metrics</div>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                          {jobStats.overall_throughput_chunks_per_sec !== undefined && (
                            <div>
                              <span className="text-gray-500">Throughput:</span>{' '}
                              <span className="font-semibold text-blue-600">
                                {jobStats.overall_throughput_chunks_per_sec.toFixed(2)} chunks/s
                              </span>
                            </div>
                          )}
                          {jobStats.avg_batch_execution_time_sec !== undefined && (
                            <div>
                              <span className="text-gray-500">Avg Batch Time:</span>{' '}
                              <span className="font-semibold">
                                {jobStats.avg_batch_execution_time_sec.toFixed(3)}s
                              </span>
                            </div>
                          )}
                          {jobStats.min_batch_execution_time_sec !== undefined && (
                            <div>
                              <span className="text-gray-500">Min Batch Time:</span>{' '}
                              <span className="font-semibold text-green-600">
                                {jobStats.min_batch_execution_time_sec.toFixed(3)}s
                              </span>
                            </div>
                          )}
                          {jobStats.max_batch_execution_time_sec !== undefined && (
                            <div>
                              <span className="text-gray-500">Max Batch Time:</span>{' '}
                              <span className="font-semibold text-orange-600">
                                {jobStats.max_batch_execution_time_sec.toFixed(3)}s
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Batch Progress Bars */}
                    {jobStats.batches && jobStats.batches.length > 0 && (
                      <div className="border-t border-gray-200 pt-3">
                        <div className="text-xs font-semibold text-gray-700 mb-3">Batch Progress ({jobStats.batches.length} batches)</div>
                        <div className="space-y-2">
                          {jobStats.batches
                            .sort((a, b) => (a.batch_index ?? 0) - (b.batch_index ?? 0))
                            .map((batch, idx) => {
                              const totalTasks = batch.tasks_count || batch.chunks_count;
                              const completedTasks = batch.completed_count;
                              const failedTasks = batch.failed_count || 0;
                              const progressPercentage = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
                              const failedPercentage = totalTasks > 0 ? (failedTasks / totalTasks) * 100 : 0;
                              
                              return (
                                <div
                                  key={batch.batch_id || idx}
                                  className="border rounded p-2 bg-white"
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-semibold text-gray-700">
                                        Batch {batch.batch_index !== undefined ? batch.batch_index + 1 : idx + 1}
                                      </span>
                                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                        batch.status === 'completed' ? 'bg-green-100 text-green-800' :
                                        batch.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                                        batch.status === 'failed' ? 'bg-red-100 text-red-800' :
                                        'bg-gray-100 text-gray-800'
                                      }`}>
                                        {batch.status}
                                      </span>
                                      {batch.worker_id && (
                                        <span className="text-xs text-gray-500 font-mono">
                                          Worker: {batch.worker_id.substring(0, 8)}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-xs text-gray-600">
                                      {completedTasks}/{totalTasks} tasks
                                      {failedTasks > 0 && (
                                        <span className="text-red-600 ml-1">({failedTasks} failed)</span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="relative h-4 bg-gray-200 rounded-full overflow-hidden">
                                    {/* Completed progress (green) */}
                                    {progressPercentage > 0 && (
                                      <div
                                        className={`absolute top-0 left-0 h-full transition-all duration-300 ${
                                          batch.status === 'completed' ? 'bg-green-500' :
                                          batch.status === 'processing' ? 'bg-blue-500' :
                                          'bg-gray-400'
                                        }`}
                                        style={{ width: `${progressPercentage}%` }}
                                      />
                                    )}
                                    {/* Failed tasks (red overlay) */}
                                    {failedPercentage > 0 && (
                                      <div
                                        className="absolute top-0 right-0 h-full bg-red-500"
                                        style={{ width: `${failedPercentage}%` }}
                                      />
                                    )}
                                  </div>
                                  {batch.status === 'processing' && (
                                    <div className="mt-1 text-xs text-gray-500">
                                      {progressPercentage.toFixed(1)}% complete
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    )}

                    {/* Batch Details */}
                    {jobStats.batches && jobStats.batches.length > 0 && (
                      <div className="border-t border-gray-200 pt-3">
                        <div className="text-xs font-semibold text-gray-700 mb-2">Batch Details ({jobStats.batches.length} batches)</div>
                        <div className="space-y-2 max-h-96 overflow-y-auto">
                          {jobStats.batches.map((batch, idx) => (
                            <div
                              key={batch.batch_id || idx}
                              className={`border rounded p-3 text-xs ${
                                batch.status === 'completed' ? 'bg-green-50 border-green-200' :
                                batch.status === 'processing' ? 'bg-blue-50 border-blue-200' :
                                batch.status === 'failed' ? 'bg-red-50 border-red-200' :
                                'bg-gray-50 border-gray-200'
                              }`}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <div className="font-semibold">
                                  Batch {batch.batch_index !== undefined ? batch.batch_index + 1 : idx + 1}
                                  {batch.batch_id && (
                                    <span className="text-gray-500 font-mono ml-2 text-xs">
                                      ({batch.batch_id.substring(0, 8)}...)
                                    </span>
                                  )}
                                  {batch.worker_id && (
                                    <span className="text-gray-600 font-mono ml-2 text-xs">
                                      [Worker: {batch.worker_id}]
                                    </span>
                                  )}
                                </div>
                                <div className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                  batch.status === 'completed' ? 'bg-green-600 text-white' :
                                  batch.status === 'processing' ? 'bg-blue-600 text-white' :
                                  batch.status === 'failed' ? 'bg-red-600 text-white' :
                                  'bg-gray-600 text-white'
                                }`}>
                                  {batch.status}
                                </div>
                              </div>
                              
                              {/* Batch Size and Counts */}
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
                                {batch.batch_size !== undefined && (
                                  <div>
                                    <span className="text-gray-500">Batch Size:</span>{' '}
                                    <span className="font-semibold">{batch.batch_size}</span>
                                  </div>
                                )}
                                <div>
                                  <span className="text-gray-500">Chunks:</span>{' '}
                                  <span className="font-semibold">{batch.chunks_count}</span>
                                </div>
                                <div>
                                  <span className="text-gray-500">Tasks:</span>{' '}
                                  <span className="font-semibold">{batch.completed_count}/{batch.tasks_count}</span>
                                </div>
                                {batch.failed_count > 0 && (
                                  <div className="text-red-600">
                                    <span className="text-gray-500">Failed:</span>{' '}
                                    <span className="font-semibold">{batch.failed_count}</span>
                                  </div>
                                )}
                              </div>

                              {/* Batch Timestamps and Duration */}
                              {(batch.created_at || batch.start_time || batch.end_time || 
                                batch.duration !== undefined || batch.execution_time !== undefined) && (
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2 text-xs border-t border-gray-300 pt-2">
                                  {batch.created_at && (
                                    <div>
                                      <span className="text-gray-500">Created:</span>{' '}
                                      <span className="font-mono">{new Date(batch.created_at).toLocaleTimeString()}</span>
                                    </div>
                                  )}
                                  {batch.start_time && (
                                    <div>
                                      <span className="text-gray-500">Started:</span>{' '}
                                      <span className="font-mono">{new Date(batch.start_time).toLocaleTimeString()}</span>
                                    </div>
                                  )}
                                  {batch.end_time && (
                                    <div>
                                      <span className="text-gray-500">Ended:</span>{' '}
                                      <span className="font-mono">{new Date(batch.end_time).toLocaleTimeString()}</span>
                                    </div>
                                  )}
                                  {(batch.execution_time !== undefined || batch.duration !== undefined) && (
                                    <div>
                                      <span className="text-gray-500">Duration:</span>{' '}
                                      <span className="font-semibold">
                                        {batch.execution_time !== undefined
                                          ? `${batch.execution_time.toFixed(3)}s`
                                          : batch.duration !== undefined
                                            ? `${(batch.duration / 1000).toFixed(3)}s`
                                            : 'N/A'}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Batch Performance Metrics */}
                              {batch.throughput_chunks_per_sec !== undefined && (
                                <div className="text-xs border-t border-gray-300 pt-2">
                                  <span className="text-gray-500">Throughput:</span>{' '}
                                  <span className="font-semibold text-blue-600">
                                    {batch.throughput_chunks_per_sec.toFixed(2)} chunks/s
                                  </span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Loading state when jobId is set but stats not loaded yet */}
                {currentJobId && !jobStats && !isActive && (
                  <div className="mt-3 pt-3 border-t border-blue-300 text-center py-4">
                    <div className="text-sm text-gray-500">Loading job statistics...</div>
                  </div>
                )}

                {/* Current Batch Stats (if no job stats yet and no jobId) */}
                {!jobStats && !currentJobId && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 pt-3 border-t border-blue-300">
                    <div className="bg-white rounded p-2">
                      <div className="text-xs text-gray-500 mb-1">Batches</div>
                      <div className="text-lg font-bold text-blue-900">{currentBatchCount}</div>
                    </div>
                    <div className="bg-white rounded p-2">
                      <div className="text-xs text-gray-500 mb-1">Submitted</div>
                      <div className="text-lg font-bold text-blue-900">{submittedCount}</div>
                    </div>
                    <div className="bg-white rounded p-2">
                      <div className="text-xs text-gray-500 mb-1">Completed</div>
                      <div className="text-lg font-bold text-green-900">{completedCount}</div>
                    </div>
                    <div className="bg-white rounded p-2">
                      <div className="text-xs text-gray-500 mb-1">Errors</div>
                      <div className="text-lg font-bold text-red-900">{errorCount}</div>
                    </div>
                  </div>
                )}

                {/* Summary when complete */}
                {currentProgress?.percentage === 100 && currentProgress.summary && (
                  <div className="mt-3 pt-3 border-t border-blue-300 bg-white rounded p-3">
                    <div className="text-sm font-semibold text-gray-800 mb-2">Execution Summary</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      <div>
                        <span className="text-gray-500">Chunks:</span>{' '}
                        <span className="font-semibold">{currentProgress.summary.totalChunks}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Batches:</span>{' '}
                        <span className="font-semibold">{currentProgress.summary.totalBatches}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Total Time:</span>{' '}
                        <span className="font-semibold">{(currentProgress.summary.totalTime / 1000).toFixed(2)}s</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Avg/Batch:</span>{' '}
                        <span className="font-semibold">{(currentProgress.summary.avgBatchTime / 1000).toFixed(2)}s</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {/* Aggregated Statistics */}
            {aggregatedStats && (
              <div className="border rounded-lg p-4 bg-green-50 border-green-200">
                <h3 className="font-semibold text-lg text-gray-800 mb-3">Aggregated Statistics</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <div className="text-sm text-gray-600 mb-1">Total Executions</div>
                    <div className="text-2xl font-bold text-green-900">{aggregatedStats.totalExecutions}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600 mb-1">Total Chunks</div>
                    <div className="text-2xl font-bold text-green-900">{aggregatedStats.totalChunksProcessed}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600 mb-1">Total Batches</div>
                    <div className="text-2xl font-bold text-green-900">{aggregatedStats.totalBatchesProcessed}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600 mb-1">Avg Execution Time</div>
                    <div className="text-xl font-bold text-green-900">
                      {(aggregatedStats.averageExecutionTime / 1000).toFixed(2)}s
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600 mb-1">Avg Batch Time</div>
                    <div className="text-xl font-bold text-green-900">
                      {(aggregatedStats.averageBatchTime / 1000).toFixed(2)}s
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600 mb-1">Avg Success Rate</div>
                    <div className="text-xl font-bold text-green-900">
                      {aggregatedStats.averageSuccessRate.toFixed(1)}%
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Recent Task Events */}
            {taskEvents.length > 0 && (
              <div className="border rounded-lg p-4 bg-white">
                <h3 className="font-semibold text-lg text-gray-800 mb-3">
                  Recent Task Events ({taskEvents.length})
                </h3>
                <div className="space-y-1 max-h-64 overflow-y-auto text-xs font-mono">
                  {taskEvents.slice(-20).reverse().map((event, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center gap-2 p-1 rounded ${
                        event.type === 'completed' ? 'bg-green-50 text-green-800' :
                        event.type === 'error' ? 'bg-red-50 text-red-800' :
                        'bg-blue-50 text-blue-800'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full bg-current"></span>
                      <span className="text-gray-500">{new Date(event.timestamp).toLocaleTimeString()}</span>
                      <span className="font-semibold">{event.type.toUpperCase()}</span>
                      <span className="text-gray-600">Task: {event.taskId.substring(0, 12)}...</span>
                      <span className="text-gray-600">Chunk: {event.chunkId.substring(0, 12)}...</span>
                      {event.error && <span className="text-red-600 ml-auto">Error: {event.error}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Execution History */}
            {executionHistory.length > 0 && (
              <div className="border rounded-lg p-4 bg-white">
                <h3 className="font-semibold text-lg text-gray-800 mb-3">
                  Execution History ({executionHistory.length})
                </h3>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {executionHistory.map((execution, idx) => (
                    <div
                      key={idx}
                      className="border rounded-lg p-3 bg-gray-50 hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-sm font-semibold text-gray-700">
                          {new Date(execution.timestamp).toLocaleString()}
                        </div>
                        <div className={`text-sm font-semibold px-2 py-1 rounded ${
                          execution.successRate >= 95 
                            ? 'bg-green-100 text-green-800'
                            : execution.successRate >= 80
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {execution.successRate.toFixed(1)}% success
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <div>
                          <span className="text-gray-500">Chunks:</span>{' '}
                          <span className="font-semibold">{execution.totalChunks}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Batches:</span>{' '}
                          <span className="font-semibold">{execution.totalBatches}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Total Time:</span>{' '}
                          <span className="font-semibold">{(execution.totalTime / 1000).toFixed(2)}s</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Avg/Batch:</span>{' '}
                          <span className="font-semibold">{(execution.avgBatchTime / 1000).toFixed(2)}s</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty State */}
            {!isActive && executionHistory.length === 0 && taskEvents.length === 0 && (
              <div className="text-gray-400 text-center py-12">
                <div className="text-lg mb-2">No embedding activity</div>
                <div className="text-sm">Statistics will appear here when embeddings are processed</div>
              </div>
            )}
          </>
        ) : (
          <div className="text-gray-500 text-center py-8">
            Loading configuration...
          </div>
        )}
      </div>
    </div>
  );
};
