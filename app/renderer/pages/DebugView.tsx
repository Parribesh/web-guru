import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { EventLog } from '../components/EventLog';
import { ChunksViewer } from '../components/ChunksViewer';
import { NavigationBar } from '../components/NavigationBar';

type DebugTab = 'event-log' | 'chunks';

export const DebugView: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<DebugTab>('event-log');

  // Hide BrowserView when debug view is active
  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.sessions?.showView) {
      console.log('[DebugView] Hiding BrowserView for session:', sessionId);
      electronAPI.sessions.showView(null);
    }

    // Cleanup: Don't restore BrowserView here - let the destination route handle it
    return () => {
      console.log('[DebugView] Unmounting, BrowserView will be managed by destination route');
    };
  }, [sessionId]);

  if (!sessionId) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-red-500">No session ID provided</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Navigation Bar */}
      <NavigationBar sessionId={sessionId} />
      
      {/* Main Content Area - Vertical Split */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 border-r border-gray-200 bg-gray-50 flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Debug Tools</h2>
          </div>
          <nav className="flex-1 p-2 space-y-1">
            <button
              onClick={() => setActiveTab('event-log')}
              className={`w-full text-left px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
                activeTab === 'event-log'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <span>📋</span>
                <span>Event Log</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('chunks')}
              className={`w-full text-left px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
                activeTab === 'chunks'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <span>📦</span>
                <span>Chunks Viewer</span>
              </div>
            </button>
          </nav>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden bg-white">
          {activeTab === 'event-log' && (
            <div className="h-full">
              <EventLog isOpen={true} onToggle={() => {}} fullPage={true} />
            </div>
          )}
          {activeTab === 'chunks' && (
            <div className="h-full">
              <ChunksViewer sessionId={sessionId} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

