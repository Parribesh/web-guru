import React, { useState, useEffect, useRef } from 'react';

interface ProgressStep {
  id: string;
  message: string;
  timestamp: number;
  progress?: {
    current: number;
    total: number;
    percentage: number;
  };
}

interface EmbeddingProgressProps {
  tabId: string | null;
  tabIsLoading?: boolean;
  tabUrl?: string;
}

export const EmbeddingProgress: React.FC<EmbeddingProgressProps> = ({ tabId, tabIsLoading, tabUrl }) => {
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  const [isActive, setIsActive] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isWaitingForPage, setIsWaitingForPage] = useState(false);
  const timeoutRefs = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const completionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const warningTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previousLoadingState = useRef<boolean | undefined>(undefined);
  const previousUrl = useRef<string | undefined>(undefined);

  // Debug logging
  useEffect(() => {
    console.log('[EmbeddingProgress] Props:', { tabId, tabIsLoading, tabUrl });
    console.log('[EmbeddingProgress] State:', { isActive, hasStarted, isWaitingForPage, stepsCount: steps.length });
  }, [tabId, tabIsLoading, tabUrl, isActive, hasStarted, isWaitingForPage, steps.length]);

  // Detect when page finishes loading
  useEffect(() => {
    if (!tabId) {
      setSteps([]);
      setIsActive(false);
      setHasStarted(false);
      setIsWaitingForPage(false);
      previousLoadingState.current = undefined;
      previousUrl.current = undefined;
      return;
    }

    // Detect navigation start (URL changed)
    if (tabUrl && tabUrl !== previousUrl.current) {
      console.log('[EmbeddingProgress] URL changed:', { from: previousUrl.current, to: tabUrl });
      
      // Clear all previous state
      setSteps([]);
      setIsActive(false);
      setHasStarted(false);
      setIsWaitingForPage(false);
      timeoutRefs.current.forEach(timeout => clearTimeout(timeout));
      timeoutRefs.current.clear();
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
        completionTimeoutRef.current = null;
      }
      
      // If it's a real URL (not blank or localhost), show loading state immediately
      // Include file:// URLs for dev sample
      const isRealUrl = tabUrl !== 'about:blank' && 
          !tabUrl.startsWith('http://localhost') && 
          !tabUrl.startsWith('http://127.0.0.1') &&
          (tabUrl.startsWith('http') || tabUrl.startsWith('file://'));
      
      if (isRealUrl) {
        // If page is already loaded (tabIsLoading is false), show "processing" state
        // Otherwise show "loading" state
        if (!tabIsLoading) {
          console.log('[EmbeddingProgress] URL changed but page already loaded, showing processing state');
          setIsWaitingForPage(false);
          setIsActive(true);
          setSteps([{
            id: 'page-loaded',
            message: 'Page loaded, processing content...',
            timestamp: Date.now(),
          }]);
        } else {
          console.log('[EmbeddingProgress] Showing loading state for URL:', tabUrl);
          setIsActive(true);
          setIsWaitingForPage(true);
          setSteps([{
            id: 'waiting',
            message: 'Page loading...',
            timestamp: Date.now(),
          }]);
        }
      }
      
      previousUrl.current = tabUrl;
    }

    // Detect when page finishes loading (isLoading goes from true to false)
    if (previousLoadingState.current === true && tabIsLoading === false) {
      console.log('[EmbeddingProgress] Page finished loading, waiting for embedding events...');
      // Page just finished loading - start showing embedding progress
      setIsWaitingForPage(false);
      setHasStarted(false);
      setIsActive(true);
      setSteps([{
        id: 'page-loaded',
        message: 'Page loaded, processing content...',
        timestamp: Date.now(),
      }]);
      
      // Clear warning timeout if it exists
      if (warningTimeoutRef.current) {
        clearTimeout(warningTimeoutRef.current);
        warningTimeoutRef.current = null;
      }
      
      // Set a timeout to show warning if no events arrive after 3 seconds
      warningTimeoutRef.current = setTimeout(() => {
        // Only show warning if still no events have arrived
        if (!hasStarted) {
          console.log('[EmbeddingProgress] No events received after page load, showing warning');
        }
      }, 3000);
      
      // Clear this step after 2 seconds if no events arrive
      setTimeout(() => {
        setSteps(prev => {
          if (prev.length === 1 && prev[0].id === 'page-loaded') {
            return [];
          }
          return prev.filter(s => s.id !== 'page-loaded');
        });
      }, 2000);
    }
    
    // Also handle case where page is already loaded when component mounts
    if (tabUrl && !tabIsLoading && !hasStarted && previousLoadingState.current === undefined) {
      console.log('[EmbeddingProgress] Page already loaded when component mounted');
      previousLoadingState.current = false;
      setIsWaitingForPage(false);
      setIsActive(true);
      setSteps([{
        id: 'page-loaded',
        message: 'Page loaded, processing content...',
        timestamp: Date.now(),
      }]);
    }
    
    // Fallback: If we have a file:// URL and it's been more than 2 seconds, assume it's loaded
    // (file:// URLs might not trigger did-stop-loading reliably)
    if (tabUrl && tabUrl.startsWith('file://') && tabIsLoading && !hasStarted) {
      const urlCheckTimeout = setTimeout(() => {
        console.log('[EmbeddingProgress] File URL timeout - assuming page is loaded');
        setIsWaitingForPage(false);
        setIsActive(true);
        setSteps([{
          id: 'page-loaded',
          message: 'Page loaded, processing content...',
          timestamp: Date.now(),
        }]);
        // Update previousLoadingState to prevent re-triggering
        previousLoadingState.current = false;
      }, 2000);
      
      return () => clearTimeout(urlCheckTimeout);
    }
    
    // If we're waiting for page but tabIsLoading is false, transition to processing
    if (isWaitingForPage && !tabIsLoading && tabUrl) {
      console.log('[EmbeddingProgress] Page finished loading, transitioning from waiting to processing');
      setIsWaitingForPage(false);
      setIsActive(true);
      setSteps([{
        id: 'page-loaded',
        message: 'Page loaded, processing content...',
        timestamp: Date.now(),
      }]);
    }

    previousLoadingState.current = tabIsLoading;
  }, [tabId, tabIsLoading, tabUrl]);

  useEffect(() => {
    if (!tabId) {
      return;
    }

    // Reset timeouts
    timeoutRefs.current.forEach(timeout => clearTimeout(timeout));
    timeoutRefs.current.clear();
    if (completionTimeoutRef.current) {
      clearTimeout(completionTimeoutRef.current);
      completionTimeoutRef.current = null;
    }

    const handleLogEvent = (event: any) => {
      const category = event.category || '';
      const message = event.message || '';
      const level = event.level || '';

      // Debug: log all events to see what we're receiving
      console.log('[EmbeddingProgress] Received log event:', { category, level, message: message.substring(0, 100) });

      // Only track QA Service, Embeddings, and Chunking events
      if ((category === 'QA Service' || category === 'Embeddings' || category === 'Chunking') &&
          (level === 'info' || level === 'success' || level === 'warning' || level === 'debug')) {
        
        // More lenient matching - catch any message from these categories
        const isEmbeddingRelated = 
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

        console.log('[EmbeddingProgress] Event matched:', { isEmbeddingRelated, category, message: message.substring(0, 50) });

        if (isEmbeddingRelated) {
          setHasStarted(true);
          setIsActive(true);
          
          // Clear warning timeout since we're receiving events
          if (warningTimeoutRef.current) {
            clearTimeout(warningTimeoutRef.current);
            warningTimeoutRef.current = null;
          }
          
          // Clear completion timeout if we get new events
          if (completionTimeoutRef.current) {
            clearTimeout(completionTimeoutRef.current);
            completionTimeoutRef.current = null;
          }
          
          const stepId = `${Date.now()}-${Math.random()}`;
          const step: ProgressStep = {
            id: stepId,
            message: message,
            timestamp: event.timestamp || Date.now(),
            progress: event.progress,
          };

          setSteps(prev => {
            // Remove old steps of the same type
            const filtered = prev.filter(s => {
              // Keep if it's a different type of message
              const sType = getStepType(s.message);
              const msgType = getStepType(message);
              return sType !== msgType;
            });
            return [...filtered, step].slice(-6); // Keep last 6 steps
          });

          // Auto-remove step after 5 seconds
          const timeout = setTimeout(() => {
            setSteps(prev => {
              const updated = prev.filter(s => s.id !== stepId);
              return updated;
            });
            timeoutRefs.current.delete(stepId);
          }, 5000);

          timeoutRefs.current.set(stepId, timeout);
          
          // If this looks like a completion message, set a timeout to hide the component
          if (message.includes('Cached') && message.includes('chunks') || 
              message.includes('Embeddings ready') ||
              message.includes('successfully')) {
            completionTimeoutRef.current = setTimeout(() => {
              setIsActive(false);
              setHasStarted(false);
              setSteps([]);
            }, 3000);
          }
        }
      }
    };

    try {
      window.electronAPI.on('log:event', handleLogEvent);
      console.log('[EmbeddingProgress] Event listener registered for tab:', tabId);
    } catch (error) {
      console.error('[EmbeddingProgress] Failed to register event listener:', error);
    }

    return () => {
      try {
        window.electronAPI.off('log:event', handleLogEvent);
        console.log('[EmbeddingProgress] Event listener removed for tab:', tabId);
      } catch (error) {
        console.error('[EmbeddingProgress] Failed to remove event listener:', error);
      }
      timeoutRefs.current.forEach(timeout => clearTimeout(timeout));
      timeoutRefs.current.clear();
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
      }
      if (warningTimeoutRef.current) {
        clearTimeout(warningTimeoutRef.current);
      }
    };
  }, [tabId]);

  // Always show something if tab exists (for debugging)
  if (!tabId) {
    console.log('[EmbeddingProgress] No tabId, returning null');
    return null;
  }

  // Show waiting state when page is loading
  if (isWaitingForPage || (tabIsLoading && !hasStarted)) {
    console.log('[EmbeddingProgress] Showing waiting state', { isWaitingForPage, tabIsLoading, hasStarted, tabUrl });
    return (
      <div className="bg-blue-50 border-b border-blue-200 px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
          <span className="text-xs font-semibold text-blue-900">
            {tabIsLoading ? 'Page loading...' : 'Waiting for page content...'}
          </span>
        </div>
        {tabUrl && (
          <div className="text-xs text-blue-700 mt-1 ml-4">
            URL: {tabUrl.substring(0, 60)}...
          </div>
        )}
      </div>
    );
  }

    // Show progress if active and has steps
    if (!isActive || steps.length === 0) {
      console.log('[EmbeddingProgress] Not active or no steps:', { isActive, stepsCount: steps.length, tabIsLoading, tabUrl });
      // For debugging: show a minimal indicator when tab exists but no progress yet
      // Include file:// URLs in the check
      const isRealUrl = tabUrl && 
          tabUrl !== 'about:blank' && 
          !tabUrl.startsWith('http://localhost') && 
          !tabUrl.startsWith('http://127.0.0.1') &&
          (tabUrl.startsWith('http') || tabUrl.startsWith('file://'));
      
      if (tabId && isRealUrl && !tabIsLoading && !hasStarted) {
        // Only show warning if page has finished loading, no events received, and enough time has passed
        // This gives DOM extraction time to complete
        return (
          <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-1 text-xs text-yellow-700">
            <div className="flex items-center gap-2">
              <span>⚠️</span>
              <span>Waiting for embedding events... (tabId: {tabId.substring(0, 8)}, url: {tabUrl.substring(0, 30)}...)</span>
            </div>
          </div>
        );
      }
      return null;
    }

  console.log('[EmbeddingProgress] Rendering progress with', steps.length, 'steps');

  return (
    <div className="bg-blue-50 border-b border-blue-200 px-4 py-2">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
        <span className="text-xs font-semibold text-blue-900">Processing Page Content</span>
      </div>
      <div className="space-y-1">
        {steps.map((step, idx) => (
          <div
            key={step.id}
            className={`text-xs transition-all duration-300 ${
              idx === steps.length - 1
                ? 'text-blue-800 font-medium'
                : 'text-blue-600 opacity-75'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-blue-400">•</span>
              <span>{formatMessage(step.message)}</span>
              {step.progress && (
                <span className="text-blue-500 ml-auto">
                  {step.progress.current}/{step.progress.total} ({step.progress.percentage}%)
                </span>
              )}
            </div>
            {step.progress && (
              <div className="mt-1 ml-4 h-1 bg-blue-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${step.progress.percentage}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

function getStepType(message: string): string {
  if (message.includes('Caching page content')) return 'cache-start';
  if (message.includes('Extracting page structure')) return 'extract';
  if (message.includes('Extracted') && message.includes('sections')) return 'extract-done';
  if (message.includes('Page has') && message.includes('words')) return 'page-info';
  if (message.includes('Chunking')) return 'chunk-start';
  if (message.includes('Created') && message.includes('chunks')) return 'chunk-done';
  if (message.includes('Starting embedding generation')) return 'embed-start';
  if (message.includes('Generating embedding')) return 'embed-progress';
  if (message.includes('Generated') && message.includes('embeddings')) return 'embed-done';
  if (message.includes('Cached') && message.includes('chunks')) return 'cache-done';
  return 'other';
}

function formatMessage(message: string): string {
  // Format message for display
  let formatted = message
    .replace(/[🔍📄✅📚🤖💭📌📊]/g, '')
    .trim();
  
  // Make progress messages more concise
  if (formatted.includes('Generating embedding')) {
    const match = formatted.match(/(\d+)\/(\d+)/);
    if (match) {
      formatted = `Processing chunk ${match[1]} of ${match[2]}`;
    }
  }
  
  return formatted;
}

