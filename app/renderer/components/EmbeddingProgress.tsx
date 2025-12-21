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
}

export const EmbeddingProgress: React.FC<EmbeddingProgressProps> = ({ tabId, tabIsLoading, tabUrl }) => {
  const [currentProgress, setCurrentProgress] = useState<CurrentProgress | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isWaitingForPage, setIsWaitingForPage] = useState(false);
  const completionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previousLoadingState = useRef<boolean | undefined>(undefined);
  const previousUrl = useRef<string | undefined>(undefined);

  // Detect when page finishes loading
  useEffect(() => {
    if (!tabId) {
      setCurrentProgress(null);
      setIsActive(false);
      setHasStarted(false);
      setIsWaitingForPage(false);
      previousLoadingState.current = undefined;
      previousUrl.current = undefined;
      return;
    }

    // Detect navigation start (URL changed)
    if (tabUrl && tabUrl !== previousUrl.current) {
      // Clear all previous state
      setCurrentProgress(null);
      setIsActive(false);
      setHasStarted(false);
      setIsWaitingForPage(false);
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
            
            setCurrentProgress({
              current: progress.current,
              total: progress.total,
              message: message,
              percentage: percentage,
            });
            
            // Hide component when progress reaches 100% and we have a completion message
            if (percentage === 100 && 
                (message.includes('Cached') || 
                 message.includes('Embeddings ready') ||
                 message.includes('successfully'))) {
              completionTimeoutRef.current = setTimeout(() => {
                setIsActive(false);
                setHasStarted(false);
                setCurrentProgress(null);
              }, 2000);
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
        <div className="flex items-center gap-2">
          <span>{formatMessage(currentProgress.message)}</span>
          <span className="text-blue-500 ml-auto">
            {currentProgress.current}/{currentProgress.total} ({currentProgress.percentage}%)
          </span>
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
    </div>
  );
};
