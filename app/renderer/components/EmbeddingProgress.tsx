import React, { useState, useEffect, useRef } from 'react';

interface EmbeddingProgressProps {
  tabId: string | null;
  tabIsLoading?: boolean;
  tabUrl?: string;
}

interface CurrentProgress {
  current: number;
  total: number;
  message: string;
  percentage: number;
  summary?: {
    totalChunks: number;
    totalBatches: number;
    totalTime: number;
    avgBatchTime: number;
  };
}

export const EmbeddingProgress: React.FC<EmbeddingProgressProps> = ({ tabId, tabIsLoading, tabUrl }) => {
  const [currentProgress, setCurrentProgress] = useState<CurrentProgress | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isWaitingForPage, setIsWaitingForPage] = useState(false);
  const completionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previousLoadingState = useRef<boolean | undefined>(undefined);
  const previousUrl = useRef<string | undefined>(undefined);
  
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
      
      // Filter completed tasks within the time window
      const recentCompletions = completedTasks.filter(
        task => task.timestamp >= windowStart
      );
      
      if (recentCompletions.length > 0) {
        // Calculate rate: completions per second
        const timeSpan = (now - recentCompletions[0].timestamp) / 1000; // in seconds
        const rate = timeSpan > 0 ? recentCompletions.length / timeSpan : 0;
        setExecutionRate(rate);
      } else {
        setExecutionRate(0);
      }
    };

    // Update rate every second
    rateUpdateIntervalRef.current = setInterval(updateRate, 1000);
    updateRate(); // Initial calculation

    return () => {
      if (rateUpdateIntervalRef.current) {
        clearInterval(rateUpdateIntervalRef.current);
      }
    };
  }, [completedTasks, rateCalculationWindow]);

  // Detect when page finishes loading
  useEffect(() => {
    if (!tabId) {
      setCurrentProgress(null);
      setIsActive(false);
      setHasStarted(false);
      setIsWaitingForPage(false);
      previousLoadingState.current = undefined;
      previousUrl.current = undefined;
      setCompletedTasks([]);
      setExecutionRate(0);
      return;
    }

    // Detect navigation start (URL changed)
    if (tabUrl && tabUrl !== previousUrl.current) {
      // Clear all previous state
      setCurrentProgress(null);
      setIsActive(false);
      setHasStarted(false);
      setIsWaitingForPage(false);
      setCompletedTasks([]);
      setExecutionRate(0);
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
        completionTimeoutRef.current = null;
      }
      
      // If it's a real URL (not blank or localhost), show loading state
      const isRealUrl = tabUrl !== 'about:blank' && 
          !tabUrl.startsWith('http://localhost') && 
          !tabUrl.startsWith('http://127.0.0.1') &&
          (tabUrl.startsWith('http') || tabUrl.startsWith('file://'));
      
      if (isRealUrl) {
        if (!tabIsLoading) {
          setIsWaitingForPage(false);
          setIsActive(true);
        } else {
          setIsActive(true);
          setIsWaitingForPage(true);
        }
      }
      
      previousUrl.current = tabUrl;
    }

    // Detect when page finishes loading (isLoading goes from true to false)
    if (previousLoadingState.current === true && tabIsLoading === false) {
      setIsWaitingForPage(false);
      setHasStarted(false);
      setIsActive(true);
    }
    
    // Handle case where page is already loaded when component mounts
    if (tabUrl && !tabIsLoading && !hasStarted && previousLoadingState.current === undefined) {
      previousLoadingState.current = false;
      setIsWaitingForPage(false);
      setIsActive(true);
    }
    
    // Fallback: If we have a file:// URL and it's been more than 2 seconds, assume it's loaded
    if (tabUrl && tabUrl.startsWith('file://') && tabIsLoading && !hasStarted) {
      const urlCheckTimeout = setTimeout(() => {
        setIsWaitingForPage(false);
        setIsActive(true);
        previousLoadingState.current = false;
      }, 2000);
      
      return () => clearTimeout(urlCheckTimeout);
    }
    
    // If we're waiting for page but tabIsLoading is false, transition to processing
    if (isWaitingForPage && !tabIsLoading && tabUrl) {
      setIsWaitingForPage(false);
      setIsActive(true);
    }

    previousLoadingState.current = tabIsLoading;
  }, [tabId, tabIsLoading, tabUrl, hasStarted, isWaitingForPage]);

  useEffect(() => {
    if (!tabId) {
      return;
    }

    if (completionTimeoutRef.current) {
      clearTimeout(completionTimeoutRef.current);
      completionTimeoutRef.current = null;
    }

    const handleLogEvent = (event: any) => {
      const category = event.category || '';
      const message = event.message || '';
      const level = event.level || '';

      // Track RAG Cache, QA Service, Embeddings, and Chunking events
      const isRelevantCategory = category === 'RAG Cache' || 
                                  category === 'QA Service' || 
                                  category === 'Embeddings' || 
                                  category === 'Chunking';
      
      if (isRelevantCategory &&
          (level === 'info' || level === 'success' || level === 'warning' || level === 'debug' || level === 'progress')) {
        
        const isEmbeddingRelated = 
          category === 'RAG Cache' ||
          category === 'QA Service' ||
          category === 'Embeddings' ||
          category === 'Chunking' ||
          message.includes('Caching') ||
          message.includes('Extracting') ||
          message.includes('Extracted') ||
          message.includes('Chunking') ||
          message.includes('Created') ||
          message.includes('chunks') ||
          message.includes('embeddings') ||
          message.includes('Generating') ||
          message.includes('embedding') ||
          message.includes('Cached') ||
          message.includes('Page has') ||
          message.includes('sections') ||
          message.includes('Processing');

        if (isEmbeddingRelated) {
          setHasStarted(prev => prev ? prev : true);
          setIsActive(prev => prev ? prev : true);
          
          // Clear completion timeout if we get new events
          if (completionTimeoutRef.current) {
            clearTimeout(completionTimeoutRef.current);
            completionTimeoutRef.current = null;
          }
          
          // Update current progress if event has progress info
          if (event.progress) {
            const progress = event.progress;
            const percentage = progress.percentage ?? Math.round((progress.current / progress.total) * 100);
            
            // Track completion when progress increases
            setCurrentProgress(prev => {
              if (prev && progress.current > prev.current) {
                // Progress increased, track completion
                setCompletedTasks(prevTasks => {
                  const newTasks = [...prevTasks, { timestamp: Date.now() }];
                  // Keep only tasks from last minute
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
            
            // Extract summary information from completion message
            let summary = undefined;
            if (message.includes('Completed:') && message.includes('batches')) {
              // Parse: "Completed: X/Y chunks | Z batches | X.Xs total | X.Xs avg/batch"
              const chunksMatch = message.match(/(\d+)\/(\d+)\s+chunks/);
              const batchesMatch = message.match(/(\d+)\s+batches/);
              const totalTimeMatch = message.match(/([\d.]+)s\s+total/);
              const avgTimeMatch = message.match(/([\d.]+)s\s+avg\/batch/);
              
              if (chunksMatch && batchesMatch && totalTimeMatch && avgTimeMatch) {
                summary = {
                  totalChunks: parseInt(chunksMatch[2]),
                  totalBatches: parseInt(batchesMatch[1]),
                  totalTime: parseFloat(totalTimeMatch[1]) * 1000, // Convert to ms
                  avgBatchTime: parseFloat(avgTimeMatch[1]) * 1000, // Convert to ms
                };
              }
            }
            
            // Update progress with summary if available
            setCurrentProgress(prev => prev ? {
              ...prev,
              summary: summary || prev.summary,
            } : null);
            
            // Hide component when progress reaches 100% and we have a completion message
            if (percentage === 100 && 
                (message.includes('Cached') || 
                 message.includes('Embeddings ready') ||
                 message.includes('successfully') ||
                 message.includes('Completed:'))) {
              // Show summary for 5 seconds before hiding
              completionTimeoutRef.current = setTimeout(() => {
                setIsActive(false);
                setHasStarted(false);
                setCurrentProgress(null);
                setCompletedTasks([]);
                setExecutionRate(0);
              }, 5000);
            }
          } else {
            // Even without progress, update message to show current activity
            setCurrentProgress(prev => prev ? {
              ...prev,
              message: message,
            } : null);
          }
        }
      }
    };

    try {
      ((window as any).electronAPI as any)?.on('log:event', handleLogEvent);
    } catch (error) {
      console.error('[EmbeddingProgress] Failed to register event listener:', error);
    }

    return () => {
      try {
        ((window as any).electronAPI as any)?.off('log:event', handleLogEvent);
      } catch (error) {
        console.error('[EmbeddingProgress] Failed to remove event listener:', error);
      }
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
      }
    };
  }, [tabId]);

  // Don't render if no tab
  if (!tabId) {
    return null;
  }

  // Show waiting state when page is loading
  if (isWaitingForPage || (tabIsLoading && !hasStarted)) {
    return (
      <div className="bg-blue-50 border-b border-blue-200 px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
          <span className="text-xs font-semibold text-blue-900">
            {tabIsLoading ? 'Page loading...' : 'Waiting for page content...'}
          </span>
        </div>
      </div>
    );
  }

  // Show progress if active
  if (!isActive || !currentProgress) {
    // Show warning if page loaded but no events received
    const isRealUrl = tabUrl && 
        tabUrl !== 'about:blank' && 
        !tabUrl.startsWith('http://localhost') && 
        !tabUrl.startsWith('http://127.0.0.1') &&
        (tabUrl.startsWith('http') || tabUrl.startsWith('file://'));
    
    if (tabId && isRealUrl && !tabIsLoading && !hasStarted) {
      return (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-1 text-xs text-yellow-700">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>Waiting for embedding events...</span>
          </div>
        </div>
      );
    }
    
    // If processing has started but no progress yet, show processing indicator
    if (hasStarted && isActive) {
      return (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            <span className="text-xs font-semibold text-blue-900">
              Processing embeddings...
            </span>
          </div>
        </div>
      );
    }
    
    return null;
  }

  // Format message for display
  const formatMessage = (msg: string): string => {
    let formatted = msg
      .replace(/[🔍📄✅📚🤖💭📌📊]/g, '')
      .trim();
    
    // Make progress messages more concise
    if (formatted.includes('Generating embedding')) {
      const match = formatted.match(/(\d+)\/(\d+)/);
      if (match) {
        formatted = `Generating embeddings: ${match[1]}/${match[2]}`;
      }
    }
    
    return formatted;
  };

  return (
    <div className="bg-blue-50 border-b border-blue-200 px-4 py-2">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
        <span className="text-xs font-semibold text-blue-900">Processing Page Content</span>
      </div>
      <div className="text-xs text-blue-800 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="flex-1 min-w-0">{formatMessage(currentProgress.message)}</span>
          <div className="flex items-center gap-3 ml-auto">
            {executionRate > 0 && (
              <span className="text-blue-600 font-semibold whitespace-nowrap">
                {executionRate.toFixed(1)}/sec
              </span>
            )}
            <span className="text-blue-500 whitespace-nowrap">
              {currentProgress.current}/{currentProgress.total} ({currentProgress.percentage}%)
            </span>
          </div>
        </div>
      </div>
      <div className="h-1.5 bg-blue-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 transition-all duration-300 ease-out"
          style={{ 
            width: `${currentProgress.percentage}%` 
          }}
        />
      </div>
      {/* Summary Section - shown when complete */}
      {currentProgress.percentage === 100 && currentProgress.summary && (
        <div className="mt-2 pt-2 border-t border-blue-300 bg-blue-100 rounded px-2 py-1.5">
          <div className="text-xs font-semibold text-blue-900 mb-1">Execution Summary</div>
          <div className="grid grid-cols-2 gap-2 text-xs text-blue-800">
            <div>
              <span className="font-medium">Chunks:</span> {currentProgress.summary.totalChunks}
            </div>
            <div>
              <span className="font-medium">Batches:</span> {currentProgress.summary.totalBatches}
            </div>
            <div>
              <span className="font-medium">Total Time:</span> {(currentProgress.summary.totalTime / 1000).toFixed(2)}s
            </div>
            <div>
              <span className="font-medium">Avg/Batch:</span> {(currentProgress.summary.avgBatchTime / 1000).toFixed(2)}s
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
