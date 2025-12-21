import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

interface NavigationBarProps {
  sessionId: string;
}

export const NavigationBar: React.FC<NavigationBarProps> = ({ sessionId }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const isSessionView = location.pathname === `/session/${sessionId}`;
  const isDebugView = location.pathname.startsWith(`/session/${sessionId}/debug`);

  return (
    <div className="border-b border-gray-200 bg-white px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate(`/session/${sessionId}`)}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            isSessionView
              ? 'bg-blue-600 text-white shadow-md'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Session View
        </button>
        <button
          onClick={() => navigate(`/session/${sessionId}/debug`)}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            isDebugView
              ? 'bg-blue-600 text-white shadow-md'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Debug View
        </button>
      </div>
      <div className="text-xs text-gray-500 font-mono">
        Session: {sessionId.substring(0, 8)}...
      </div>
    </div>
  );
};


