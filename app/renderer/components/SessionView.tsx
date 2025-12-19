import React, { useState, useEffect, useRef } from 'react';
import { AddressBar } from './AddressBar';
import { AIChatPanel } from '../ai-ui/AIChatPanel';

interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
}

// Convert AgentMessage to ChatMessage format for AIChatPanel
function convertToChatMessages(agentMessages: AgentMessage[]): Array<{ from: 'user' | 'ai'; content: string }> {
  return agentMessages
    .filter(msg => msg.role === 'user' || msg.role === 'assistant')
    .map(msg => ({
      from: msg.role === 'user' ? 'user' : 'ai',
      content: msg.content
    }));
}

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
  
  console.log('SessionView render:', {
    sessionId: session.id,
    url: session.url,
    title: session.title,
    state: session.state,
    messagesCount: messages.length
  });

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

        {/* Right: Agent Chat */}
        <div className="w-[420px] border-l border-gray-300 flex flex-col bg-white">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
            <h3 className="font-semibold text-gray-900 text-sm">AI Agent</h3>
          </div>
          <div className="flex-1 overflow-hidden">
            <AIChatPanel
              messages={convertToChatMessages(messages)}
              onSend={async (text: string) => {
                onSendMessage(text);
                return null; // Return null since we handle updates via events
              }}
              isProcessing={session.state === 'thinking' || session.state === 'executing_tool'}
              hasActiveTab={true}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

