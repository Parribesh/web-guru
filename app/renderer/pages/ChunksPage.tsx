import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChunksViewer } from '../components/ChunksViewer';

export const ChunksPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  // BrowserViews are hidden by default - no need to hide them here
  // When navigating back to session view, SessionViewWrapper will explicitly show it
  // When navigating to session list, BrowserViews remain hidden (default state)

  if (!sessionId) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-red-500">No session ID provided</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-4 bg-gray-50 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-800">Chunks Viewer</h1>
          <p className="text-sm text-gray-600 mt-1">Session: {sessionId.substring(0, 8)}...</p>
        </div>
        <button
          onClick={() => navigate(`/session/${sessionId}`)}
          className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors border border-gray-300"
        >
          ← Back to Session
        </button>
      </div>

      {/* Chunks Viewer */}
      <div className="flex-1 overflow-hidden">
        <ChunksViewer sessionId={sessionId} />
      </div>
    </div>
  );
};

