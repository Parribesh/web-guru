import React, { useState, useEffect, useRef } from 'react';
import { AIResponse } from '../../shared/types';

type ChatMessage = { 
  from: 'user' | 'ai'; 
  content: string;
  data?: {
    relevantChunks?: Array<{
      chunkId: string;
      excerpt: string;
      relevance: string;
    }>;
    sourceLocation?: {
      section?: string;
      approximatePosition: string;
    };
    prompt?: string; // The full prompt sent to LLM
  };
};
type ProgressStep = { id: string; message: string; timestamp: number };

interface AIChatPanelProps {
  messages: ChatMessage[];
  onSend: (text: string) => Promise<AIResponse | null>;
  onNewTask?: () => void; // Callback for new task button
  isProcessing: boolean;
  hasActiveTab: boolean;
}

export const AIChatPanel: React.FC<AIChatPanelProps> = ({
  messages,
  onSend,
  onNewTask,
  isProcessing,
  hasActiveTab
}) => {
  const [input, setInput] = useState('');
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([]);
  const progressTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Listen to log events for progress updates
  useEffect(() => {
    const handleLogEvent = (event: any) => {
      // Only show QA Service and AI Service events during processing
      if (!isProcessing) return;
      
      const category = event.category || '';
      const message = event.message || '';
      const level = event.level || '';
      
      // Filter for relevant progress events (only INFO and SUCCESS from QA/AI Service)
      if ((category === 'QA Service' || category === 'AI Service') && 
          (level === 'info' || level === 'success')) {
        // Skip very verbose messages
        if (message.includes('Tab ID:') || message.includes('Processing question:')) {
          return;
        }
        
        // Create a progress step
        const stepId = `${Date.now()}-${Math.random()}`;
        const step: ProgressStep = {
          id: stepId,
          message: message,
          timestamp: event.timestamp || Date.now()
        };
        
        setProgressSteps(prev => {
          // Remove old steps that are similar (replace with new)
          const filtered = prev.filter(s => {
            // Remove if it's a similar step (same emoji/action)
            const sEmoji = s.message.match(/^[^\s]+/)?.[0] || '';
            const msgEmoji = message.match(/^[^\s]+/)?.[0] || '';
            return sEmoji !== msgEmoji;
          });
          return [...filtered, step].slice(-4); // Keep last 4 steps
        });
        
        // Auto-remove step after it's been replaced or after 3 seconds
        const timeout = setTimeout(() => {
          setProgressSteps(prev => {
            const updated = prev.filter(s => s.id !== stepId);
            return updated;
          });
          progressTimeoutRef.current.delete(stepId);
        }, 3000);
        
        progressTimeoutRef.current.set(stepId, timeout);
      }
    };

    window.electronAPI.on('log:event', handleLogEvent);

    return () => {
      window.electronAPI.off('log:event', handleLogEvent);
      // Clear all timeouts
      progressTimeoutRef.current.forEach(timeout => clearTimeout(timeout));
      progressTimeoutRef.current.clear();
    };
  }, [isProcessing]);

  // Clear progress when processing stops
  useEffect(() => {
    if (!isProcessing) {
      // Clear all progress steps after a short delay
      setTimeout(() => {
        setProgressSteps([]);
        progressTimeoutRef.current.forEach(timeout => clearTimeout(timeout));
        progressTimeoutRef.current.clear();
      }, 500);
    }
  }, [isProcessing]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !hasActiveTab) return;
    setInput('');
    await onSend(text);
  };

  const handleNewTask = () => {
    setInput('');
    if (onNewTask) {
      onNewTask();
    }
  };

  return (
    <div className="ai-chat">
      <div className="ai-chat__header">
        <div>
          <div className="ai-chat__title">AI Copilot</div>
          <div className="ai-chat__subtitle">Plan, browse, and fill forms</div>
        </div>
        <button
          className="ai-chat__action"
          onClick={handleNewTask}
          disabled={!hasActiveTab || isProcessing}
          title="Start a new task (clear conversation)"
        >
          New task
        </button>
      </div>

      <div className="ai-chat__body space-y-2 overflow-y-auto">
        {messages.length === 0 && (
          <div className="ai-chat__placeholder">
            Conversation will appear here. Ask the agent to navigate, extract data,
            fill forms, or book a flight.
          </div>
        )}
        {messages.map((m, idx) => {
          // Check if this message has chunk information (from AIResponse)
          const messageData = (m as any).data;
          const hasChunks = messageData?.relevantChunks && messageData.relevantChunks.length > 0;
          
          return (
            <div key={idx}>
              <div
                className={`px-3 py-2 rounded-md text-sm ${
                  m.from === 'user' ? 'bg-blue-50 text-gray-900' : 'bg-gray-100 text-gray-800'
                }`}
              >
                <span className="font-semibold mr-1">{m.from === 'user' ? 'You:' : 'AI:'}</span>
                {m.content}
              </div>
              {m.from === 'ai' && (
                <>
                  {messageData?.prompt && (
                    <div className="mt-2 px-3 py-2 bg-purple-50 border-l-4 border-purple-400 rounded text-xs">
                      <details className="mb-2">
                        <summary className="cursor-pointer text-purple-700 hover:text-purple-900 font-semibold">
                          🔍 View LLM Prompt
                        </summary>
                        <div className="mt-2 p-2 bg-white rounded text-gray-700 text-xs whitespace-pre-wrap font-mono max-h-96 overflow-y-auto">
                          {messageData.prompt}
                        </div>
                      </details>
                    </div>
                  )}
                  {hasChunks && (
                    <div className="mt-2 px-3 py-2 bg-yellow-50 border-l-4 border-yellow-400 rounded text-xs">
                      <div className="font-semibold text-yellow-800 mb-1">
                        📚 Sources used ({messageData.relevantChunks.length}):
                      </div>
                      {messageData.relevantChunks.map((chunk: any, chunkIdx: number) => {
                        const excerpt = chunk.excerpt || 'No content available';
                        const hasContent = excerpt && excerpt.trim().length > 0 && excerpt !== 'No content available';
                        
                        return (
                          <details key={chunkIdx} className="mb-2 last:mb-0">
                            <summary className="cursor-pointer text-yellow-700 hover:text-yellow-900">
                              {chunk.relevance} - {hasContent ? 'Click to view' : 'No content'}
                            </summary>
                            {hasContent && (
                              <div className="mt-1 p-2 bg-white rounded text-gray-700 text-xs whitespace-pre-wrap">
                                {excerpt}
                              </div>
                            )}
                            {!hasContent && (
                              <div className="mt-1 p-2 bg-white rounded text-gray-500 text-xs italic">
                                This chunk has no content. This may indicate a content extraction issue.
                              </div>
                            )}
                          </details>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
        {isProcessing && progressSteps.length > 0 && (
          <div className="space-y-1 mb-2">
            {progressSteps.map((step, idx) => (
              <div
                key={step.id}
                className={`text-xs px-2 py-1 rounded transition-all duration-300 ${
                  idx === progressSteps.length - 1
                    ? 'text-blue-700 bg-blue-100 font-medium'
                    : 'text-gray-600 bg-gray-50 opacity-75'
                }`}
              >
                {step.message}
              </div>
            ))}
          </div>
        )}
        {isProcessing && progressSteps.length === 0 && (
          <div className="text-xs text-gray-500 italic">Preparing response...</div>
        )}
      </div>

      <div className="ai-chat__composer">
        <input
          className="ai-chat__input"
          placeholder="Ask the AI to browse or perform a task..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={!hasActiveTab || isProcessing}
        />
        <button
          className="ai-chat__send disabled:opacity-50"
          onClick={handleSend}
          disabled={!hasActiveTab || isProcessing}
        >
          Send
        </button>
      </div>
    </div>
  );
};

