import React, { useState, useEffect, useRef } from 'react';
import { AddressBar } from './AddressBar';
import { AIChatPanel } from '../ai-ui/AIChatPanel';
import { EventLog } from './EventLog';
import { EmbeddingProgress } from './EmbeddingProgress';
import { AIResponse } from '../../shared/types';

interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
}

// This function is no longer needed - we handle conversion in useEffect

interface AgentSession {
  id: string;
  url: string;
  title: string;
  state: string;
  messages: AgentMessage[];
  context: {
    url: string;
    title: string;
  };
}

interface SessionViewProps {
  session: AgentSession;
  onNavigate: (url: string) => void;
  onSendMessage: (content: string) => void;
  onBack: () => void;
}

export const SessionView: React.FC<SessionViewProps> = ({
  session,
  onNavigate,
  onSendMessage,
  onBack
}) => {
  const messages = session.messages || [];
  const browserViewportRef = useRef<HTMLDivElement>(null);
  const [tabId, setTabId] = useState<string | null>(null);
  const [tabIsLoading, setTabIsLoading] = useState(false);
  const [tabUrl, setTabUrl] = useState<string>(session.url || '');
  const [chatMessages, setChatMessages] = useState<Array<{ from: 'user' | 'ai'; content: string; data?: any }>>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isEventLogOpen, setIsEventLogOpen] = useState(false);
  
  console.log('SessionView render:', {
    sessionId: session.id,
    url: session.url,
    title: session.title,
    state: session.state,
    messagesCount: messages.length
  });

  // Get tabId for this session and listen to tab updates
  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.sessions) return;

    const fetchTabId = async () => {
      try {
        // Get tabId from session via IPC
        const fetchedTabId = await electronAPI.sessions.getTabId(session.id);
        if (fetchedTabId) {
          setTabId(fetchedTabId);
          console.log('[SessionView] Got tabId for session:', fetchedTabId);
        }
      } catch (error) {
        console.error('Failed to get session tabId:', error);
      }
    };

    fetchTabId();

    // Listen for tab updates that match this session's tab
    const handleTabUpdate = (updatedTab: any) => {
      if (updatedTab.id === tabId) {
        setTabIsLoading(updatedTab.isLoading || false);
        setTabUrl(updatedTab.url || session.url || '');
        console.log('[SessionView] Tab updated:', updatedTab);
      }
    };

    // Listen for session updates (which may include URL changes)
    const handleSessionUpdate = (updatedSession: any) => {
      if (updatedSession.id === session.id) {
        setTabUrl(updatedSession.url || '');
      }
    };

    if (electronAPI.on) {
      electronAPI.on('tab:update', handleTabUpdate);
      electronAPI.on('agent:session-updated', handleSessionUpdate);
    }

    return () => {
      if (electronAPI.off) {
        electronAPI.off('tab:update', handleTabUpdate);
        electronAPI.off('agent:session-updated', handleSessionUpdate);
      }
    };
  }, [session.id, session.url, tabId]);

  // Convert agent messages to chat messages with data
  useEffect(() => {
    const converted = messages
      .filter(msg => msg.role === 'user' || msg.role === 'assistant')
      .map(msg => {
        // Try to extract data from message if it exists
        const messageData = (msg as any).data;
        return {
          from: msg.role === 'user' ? 'user' as const : 'ai' as const,
          content: msg.content,
          data: messageData || undefined
        };
      });
    setChatMessages(converted);
  }, [messages]);

  // Sync BrowserView bounds with React div using ResizeObserver
  useEffect(() => {
    const viewportElement = browserViewportRef.current;
    if (!viewportElement) return;

    const updateBounds = () => {
      const rect = viewportElement.getBoundingClientRect();
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.sessions?.updateViewBounds) {
        electronAPI.sessions.updateViewBounds(session.id, {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    };

    // Update bounds with multiple strategies to ensure it works on initial load
    // 1. Immediate (might not have layout yet)
    updateBounds();
    
    // 2. After next frame (DOM should be laid out)
    requestAnimationFrame(() => {
      updateBounds();
      // 3. After a tiny delay (for any async layout)
      setTimeout(updateBounds, 0);
    });
    
    // 4. After a short delay (for any CSS transitions/animations)
    const delayedTimeout = setTimeout(() => {
      updateBounds();
    }, 50);
    
    // 5. After layout settles (for complex layouts)
    const layoutTimeout = setTimeout(() => {
      updateBounds();
    }, 200);

    // Use ResizeObserver to track size changes
    const resizeObserver = new ResizeObserver(() => {
      updateBounds();
    });

    resizeObserver.observe(viewportElement);

    // Also listen to window resize (for position changes)
    window.addEventListener('resize', updateBounds);
    window.addEventListener('scroll', updateBounds);

    return () => {
      clearTimeout(delayedTimeout);
      clearTimeout(layoutTimeout);
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateBounds);
      window.removeEventListener('scroll', updateBounds);
    };
  }, [session.id]);

  return (
    <div className="flex flex-col h-screen w-screen bg-white overflow-hidden" style={{ minHeight: '100vh', minWidth: '100vw' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-300 bg-white shadow-sm z-10">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors font-medium"
          >
            ← Back
          </button>
          <div className="h-6 w-px bg-gray-300"></div>
          <div>
            <h2 className="font-semibold text-gray-900 text-base">{session.title || 'Session'}</h2>
            <p className="text-xs text-gray-500 font-mono truncate max-w-md">{session.url || 'No URL'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-3 py-1 text-xs font-medium rounded-full ${
            session.state === 'idle' ? 'bg-green-100 text-green-700' :
            session.state === 'thinking' ? 'bg-yellow-100 text-yellow-700 animate-pulse' :
            session.state === 'executing_tool' ? 'bg-blue-100 text-blue-700 animate-pulse' :
            'bg-gray-100 text-gray-700'
          }`}>
            {session.state.replace('_', ' ')}
          </span>
        </div>
      </div>

      {/* Content Area - Split Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Browser Viewport */}
        <div className="flex-1 flex flex-col bg-gray-900 border-r border-gray-300">
          <div className="bg-white border-b border-gray-200 px-3 py-2">
            <AddressBar
              url={session.url}
              isLoading={false}
              canGoBack={false}
              canGoForward={false}
              onNavigate={onNavigate}
              onBack={() => {}}
              onForward={() => {}}
              onReload={() => {}}
              onStop={() => {}}
            />
          </div>
          <div 
            ref={browserViewportRef}
            data-browser-viewport
            className="flex-1 bg-black relative"
            style={{ minHeight: 0 }} // Important for flexbox
          >
            {/* BrowserView will be rendered here by Electron - bounds synced with this div */}
            {!session.url && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400 pointer-events-none">
                <div className="text-center">
                  <div className="text-6xl mb-4">🌐</div>
                  <p className="text-lg font-medium mb-2">No page loaded</p>
                  <p className="text-sm">Enter a URL in the address bar above</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Agent Chat + Event Log */}
        <div className="w-[420px] border-l border-gray-300 flex flex-col bg-white">
          {/* Embedding Progress - show above chat */}
          {tabId && (
            <div className="border-b border-gray-200">
              <EmbeddingProgress 
                tabId={tabId}
                tabIsLoading={tabIsLoading}
                tabUrl={tabUrl}
              />
            </div>
          )}
          
          {/* AI Chat Panel */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <AIChatPanel
              messages={chatMessages}
              onSend={async (text: string): Promise<AIResponse | null> => {
                setIsProcessing(true);
                try {
                  const electronAPI = (window as any).electronAPI;
                  
                  // Use the tab-based AI system with session's tabId
                  // Get tabId for this session from backend
                  let actualTabId = tabId;
                  if (!actualTabId) {
                    // Get tabId from session via IPC
                    try {
                      const tabIdResult = await electronAPI.sessions.getTabId?.(session.id);
                      if (tabIdResult) {
                        actualTabId = tabIdResult;
                        setTabId(tabIdResult);
                      }
                    } catch (error) {
                      console.warn('Could not get tabId for session, using session ID:', error);
                      actualTabId = session.id; // Fallback
                    }
                  }

                  // Send AI request using QA service (RAG system)
                  const response = await electronAPI.qa.ask({
                    question: text,
                    tabId: actualTabId,
                    context: {
                      url: session.url,
                      title: session.title
                    }
                  });

                  // Add user message
                  setChatMessages(prev => [...prev, {
                    from: 'user',
                    content: text
                  }]);

                  // Add AI response with data
                  if (response && response.success) {
                    setChatMessages(prev => [...prev, {
                      from: 'ai',
                      content: response.content || '',
                      data: {
                        relevantChunks: response.relevantChunks,
                        sourceLocation: response.sourceLocation,
                        prompt: response.prompt
                      }
                    }]);
                  }

                  // Also call the session sendMessage for session state updates
                  onSendMessage(text);
                  
                  return response;
                } catch (error) {
                  console.error('Failed to send AI request:', error);
                  return null;
                } finally {
                  setIsProcessing(false);
                }
              }}
              isProcessing={isProcessing || session.state === 'thinking' || session.state === 'executing_tool'}
              hasActiveTab={!!tabId}
            />
          </div>

          {/* Event Log Toggle Button */}
          <div className="border-t border-gray-200 px-4 py-2 bg-gray-50">
            <button
              onClick={() => setIsEventLogOpen(!isEventLogOpen)}
              className="w-full px-3 py-2 text-xs font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {isEventLogOpen ? '▼' : '▲'} Event Log
            </button>
          </div>

          {/* Event Log Panel */}
          {isEventLogOpen && (
            <div className="h-64 border-t border-gray-300">
              <EventLog 
                isOpen={isEventLogOpen}
                onToggle={() => setIsEventLogOpen(!isEventLogOpen)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

