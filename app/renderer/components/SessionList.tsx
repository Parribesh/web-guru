import React, { useState, useEffect } from 'react';

// Helper function to get test booking URL
async function getTestBookingUrl(): Promise<string> {
  const electronAPI = (window as any).electronAPI;
  if (electronAPI?.utils?.getTestBookingUrl) {
    try {
      const url = await electronAPI.utils.getTestBookingUrl();
      if (url) return url;
    } catch (error) {
      console.warn('Could not get test booking URL from main process:', error);
    }
  }
  
  // Fallback: throw error - user should see this
  throw new Error('Could not get test booking URL - IPC not available');
}

interface AgentSession {
  id: string;
  url: string;
  title: string;
  state: string;
  messages: any[];
  context: {
    url: string;
    title: string;
  };
  createdAt: number;
  updatedAt: number;
}

interface SessionListProps {
  sessions: AgentSession[];
  onCreateSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onRefresh?: () => void;
}

export const SessionList: React.FC<SessionListProps> = ({
  sessions,
  onCreateSession,
  onSelectSession,
  onRefresh
}) => {
  console.log('SessionList render:', { sessionsCount: sessions.length, sessions: sessions.map(s => ({ id: s.id, title: s.title })) });
  
  return (
    <div className="flex flex-col h-screen w-screen bg-gradient-to-br from-gray-50 to-gray-100" style={{ minHeight: '100vh', minWidth: '100vw' }}>
      {sessions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center min-h-screen">
          <div className="text-center max-w-md mx-auto px-6">
            <div className="text-8xl mb-6 animate-pulse">🤖</div>
            <h1 className="text-3xl font-bold text-gray-900 mb-3">Welcome to AI Browser</h1>
            <p className="text-lg text-gray-600 mb-8">Start a new session to begin working with your AI agent</p>
            <div className="flex flex-col gap-4">
              <button
                onClick={onCreateSession}
                className="px-8 py-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all font-semibold text-lg shadow-lg hover:shadow-xl transform hover:scale-105"
              >
                Start New Session
              </button>
              <button
                onClick={async () => {
                  const electronAPI = (window as any).electronAPI;
                  if (!electronAPI?.sessions) {
                    console.error('electronAPI.sessions not available');
                    return;
                  }
                  try {
                    const testBookingUrl = await getTestBookingUrl();
                    const session = await electronAPI.sessions.create({ url: testBookingUrl });
                    console.log('Test booking session created:', session);
                  } catch (error) {
                    console.error('Failed to create test session:', error);
                    // Fallback to regular session creation
                    onCreateSession();
                  }
                }}
                className="px-8 py-4 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-xl hover:from-purple-700 hover:to-purple-800 transition-all font-semibold text-lg shadow-lg hover:shadow-xl transform hover:scale-105"
              >
                🧪 Start Test Booking Website
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
        <div className="p-6 border-b border-gray-200 bg-white shadow-sm">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Agent Sessions</h1>
              <p className="text-sm text-gray-600 mt-1">Manage your AI agent sessions</p>
            </div>
            <div className="flex gap-2">
              {onRefresh && (
                <button
                  onClick={onRefresh}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium shadow-md"
                  title="Refresh sessions list"
                >
                  ↻ Refresh
                </button>
              )}
              <button
                onClick={async () => {
                  const electronAPI = (window as any).electronAPI;
                  if (!electronAPI?.sessions) {
                    console.error('electronAPI.sessions not available');
                    return;
                  }
                  try {
                    // Get test booking URL from main process
                    const testBookingUrl = await getTestBookingUrl();
                    const session = await electronAPI.sessions.create({ url: testBookingUrl });
                    console.log('Test booking session created:', session);
                  } catch (error) {
                    console.error('Failed to create test session:', error);
                    // Fallback to regular session creation
                    onCreateSession();
                  }
                }}
                className="px-4 py-2 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-lg hover:from-purple-700 hover:to-purple-800 transition-colors text-sm font-medium shadow-md"
                title="Start a session with the test booking website"
              >
                🧪 Test Website
              </button>
              <button
                onClick={onCreateSession}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium shadow-md"
              >
                + New Session
              </button>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Active Sessions ({sessions.length})</h2>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                className="bg-white rounded-xl border-2 border-gray-200 p-5 hover:border-blue-500 hover:shadow-lg transition-all cursor-pointer transform hover:scale-[1.02]"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg text-gray-900 mb-2">
                      {session.title || 'Untitled Session'}
                    </h3>
                    <p className="text-sm text-gray-600 mb-3 truncate font-mono">{session.url || 'No URL'}</p>
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span className="flex items-center gap-2">
                        <span className={`w-3 h-3 rounded-full ${
                          session.state === 'idle' ? 'bg-green-500' :
                          session.state === 'thinking' ? 'bg-yellow-500 animate-pulse' :
                          session.state === 'executing_tool' ? 'bg-blue-500 animate-pulse' :
                          'bg-gray-400'
                        }`}></span>
                        <span className="font-medium capitalize">{session.state.replace('_', ' ')}</span>
                      </span>
                      <span className="bg-gray-100 px-2 py-1 rounded">{session.messages.length} messages</span>
                      <span>{new Date(session.updatedAt).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        </>
      )}
    </div>
  );
};

