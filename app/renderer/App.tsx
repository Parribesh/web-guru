import React, { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, useNavigate, useParams } from "react-router-dom";
import { SessionList } from "./components/SessionList";
import { SessionView } from "./components/SessionView";
import { ChunksPage } from "./pages/ChunksPage";
import { DebugView } from "./pages/DebugView";

interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
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
  createdAt: number;
  updatedAt: number;
}

// Type guard for electronAPI with sessions
interface ElectronAPIWithSessions {
  sessions: {
    create: (request?: {
      url?: string;
      initialMessage?: string;
    }) => Promise<AgentSession>;
    get: (sessionId: string) => Promise<AgentSession | null>;
    getAll: () => Promise<AgentSession[]>;
    delete: (sessionId: string) => Promise<boolean>;
    navigate: (sessionId: string, url: string) => Promise<{ success: boolean }>;
    showView: (sessionId: string | null) => Promise<{ success: boolean }>;
    updateViewBounds: (
      sessionId: string,
      bounds: { x: number; y: number; width: number; height: number }
    ) => Promise<{ success: boolean }>;
  };
  agent: {
    sendMessage: (
      sessionId: string,
      content: string
    ) => Promise<{ success: boolean }>;
  };
  on: (channel: string, callback: (...args: any[]) => void) => void;
  off: (channel: string, callback: (...args: any[]) => void) => void;
  [key: string]: any; // Allow other properties
}

// Use type assertion - electronAPI is already declared in preload

// Wrapper component for SessionView to access route params
const SessionViewWrapper: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<AgentSession | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!sessionId) return;

    const electronAPI = (window as any).electronAPI as ElectronAPIWithSessions;
    if (!electronAPI?.sessions) return;

    const loadSession = async () => {
      try {
        const loadedSession = await electronAPI.sessions.get(sessionId);
        if (loadedSession) {
          setSession(loadedSession);
          // Show BrowserView for this session
          console.log('[SessionViewWrapper] Showing BrowserView for session:', sessionId);
          await electronAPI.sessions.showView(sessionId);
        }
      } catch (error) {
        console.error("Failed to load session:", error);
      }
    };

    loadSession();

    // Listen for session updates
    const handleSessionUpdate = (updatedSession: AgentSession) => {
      if (updatedSession.id === sessionId) {
        setSession(updatedSession);
      }
    };

    if (electronAPI?.on) {
      electronAPI.on("agent:session-updated", handleSessionUpdate);
    }

    // Cleanup: Hide BrowserView when component unmounts (navigating away from session view)
    return () => {
      console.log('[SessionViewWrapper] Unmounting, hiding BrowserView for session:', sessionId);
      if (electronAPI?.sessions?.showView) {
        electronAPI.sessions.showView(null);
      }
      if (electronAPI?.off) {
        electronAPI.off("agent:session-updated", handleSessionUpdate);
      }
    };
  }, [sessionId]);

  const handleNavigate = async (url: string) => {
    if (!sessionId) return;
    const electronAPI = (window as any).electronAPI as ElectronAPIWithSessions;
    if (!electronAPI?.sessions) return;
    try {
      await electronAPI.sessions.navigate(sessionId, url);
    } catch (error) {
      console.error("Failed to navigate:", error);
    }
  };

  const handleSendMessage = async (content: string) => {
    if (!sessionId) return;
    const electronAPI = (window as any).electronAPI as ElectronAPIWithSessions;
    if (!electronAPI?.agent) return;
    try {
      await electronAPI.agent.sendMessage(sessionId, content);
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  };

  const handleBack = () => {
    // Hide BrowserView when navigating away from session view
    const electronAPI = (window as any).electronAPI as ElectronAPIWithSessions;
    if (electronAPI?.sessions?.showView) {
      console.log('[SessionViewWrapper] Hiding BrowserView on back navigation');
      electronAPI.sessions.showView(null);
    }
    navigate('/');
  };

  if (!session) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div>Loading session...</div>
      </div>
    );
  }

  return (
    <SessionView
      session={session}
      onNavigate={handleNavigate}
      onSendMessage={handleSendMessage}
      onBack={handleBack}
    />
  );
};

// Wrapper component for DebugView to access route params
const DebugViewWrapper: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  
  if (!sessionId) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-red-500">No session ID provided</div>
      </div>
    );
  }

  return <DebugView />;
};

const App: React.FC = () => {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );
  const [selectedSession, setSelectedSession] = useState<AgentSession | null>(
    null
  );

  // Load all sessions on mount
  useEffect(() => {
    const electronAPI = (window as any).electronAPI as ElectronAPIWithSessions;
    if (!electronAPI?.sessions) {
      console.error("electronAPI.sessions not available");
      return;
    }

    const loadSessions = async () => {
      try {
        console.log("🔄 Loading all sessions...");
        const allSessions = await electronAPI.sessions.getAll();
        console.log(
          "📋 Loaded sessions:",
          allSessions.length,
          allSessions.map((s) => ({ id: s.id, title: s.title }))
        );
        setSessions(allSessions);
      } catch (error) {
        console.error("Failed to load sessions:", error);
      }
    };

    loadSessions();

    // Listen for session updates
    const handleSessionCreated = (session: AgentSession) => {
      console.log("🎉 Session created event received in React:", session);
      setSessions((prev) => {
        // Check if session already exists
        if (prev.find((s) => s.id === session.id)) {
          console.log("Session already exists, updating:", session.id);
          return prev.map((s) => (s.id === session.id ? session : s));
        }
        console.log("Adding new session to list:", session.id);
        return [...prev, session];
      });
      // Always select newly created session
      setSelectedSessionId(session.id);
      setSelectedSession(session);
    };

    const handleSessionUpdated = (session: AgentSession) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === session.id ? session : s))
      );
      if (selectedSessionId === session.id) {
        setSelectedSession(session);
      }
    };

    const handleSessionDeleted = (sessionId: string) => {
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (selectedSessionId === sessionId) {
        setSelectedSessionId(null);
        setSelectedSession(null);
      }
    };

    if (electronAPI?.on) {
      console.log("🎧 Setting up session event listeners...");
      electronAPI.on("agent:session-created", handleSessionCreated);
      electronAPI.on("agent:session-updated", handleSessionUpdated);
      electronAPI.on("agent:session-deleted", handleSessionDeleted);
      console.log("✅ Event listeners registered");
    } else {
      console.error("❌ electronAPI.on not available");
    }

    return () => {
      if (electronAPI?.off) {
        electronAPI.off("agent:session-created", handleSessionCreated);
        electronAPI.off("agent:session-updated", handleSessionUpdated);
        electronAPI.off("agent:session-deleted", handleSessionDeleted);
      }
    };
  }, [selectedSessionId]);

  // Note: BrowserView visibility is now managed by route components:
  // - SessionList: Hides BrowserView on mount
  // - SessionViewWrapper: Shows BrowserView on mount, hides on unmount
  // - ChunksPage: Hides BrowserView on mount

  // Note: Route changes are handled by React Router
  // BrowserView visibility is managed by individual route components

  const handleCreateSession = async () => {
    const electronAPI = (window as any).electronAPI as ElectronAPIWithSessions;
    if (!electronAPI?.sessions) {
      console.error("electronAPI.sessions not available");
      return;
    }
    try {
      const session = await electronAPI.sessions.create();
      console.log("Session created:", session);
      // Session will be set via event listener, but set it immediately too
      setSelectedSessionId(session.id);
      setSelectedSession(session);
      setSessions((prev) => {
        if (prev.find((s) => s.id === session.id)) {
          return prev;
        }
        return [...prev, session];
      });
      // Navigate to session page
      window.history.pushState({}, '', `/session/${session.id}`);
    } catch (error) {
      console.error("Failed to create session:", error);
    }
  };

  const handleSelectSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    // Navigate will be handled by React Router
  };

  const handleBackToSessions = async () => {
    setSelectedSessionId(null);
    setSelectedSession(null);
    // Hide BrowserViews when going back to session list
    const electronAPI = (window as any).electronAPI as ElectronAPIWithSessions;
    if (electronAPI?.sessions) {
      await electronAPI.sessions.showView(null);
    }
  };

  const handleRefreshSessions = async () => {
    const electronAPI = (window as any).electronAPI as ElectronAPIWithSessions;
    if (!electronAPI?.sessions) return;
    try {
      console.log("🔄 Manually refreshing sessions...");
      const allSessions = await electronAPI.sessions.getAll();
      console.log("📋 Refreshed sessions:", allSessions.length);
      setSessions(allSessions);
    } catch (error) {
      console.error("Failed to refresh sessions:", error);
    }
  };

  const handleNavigate = async (url: string) => {
    if (!selectedSessionId) return;
    const electronAPI = (window as any).electronAPI as ElectronAPIWithSessions;
    if (!electronAPI?.sessions) return;
    try {
      await electronAPI.sessions.navigate(selectedSessionId, url);
      // Session will be updated via event listener
    } catch (error) {
      console.error("Failed to navigate:", error);
    }
  };

  const handleSendMessage = async (content: string) => {
    if (!selectedSessionId) return;
    const electronAPI = (window as any).electronAPI as ElectronAPIWithSessions;
    if (!electronAPI?.agent) return;
    try {
      await electronAPI.agent.sendMessage(selectedSessionId, content);
      // Session will be updated via event listener
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  };

  // Debug logging
  console.log("App render:", {
    selectedSessionId,
    hasSelectedSession: !!selectedSession,
    sessionsCount: sessions.length,
    sessions: sessions.map((s) => ({ id: s.id, title: s.title, url: s.url })),
  });

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <SessionList
              sessions={sessions}
              onCreateSession={handleCreateSession}
              onSelectSession={handleSelectSession}
              onRefresh={handleRefreshSessions}
            />
          }
        />
        <Route
          path="/session/:sessionId"
          element={<SessionViewWrapper />}
        />
        <Route
          path="/session/:sessionId/debug"
          element={<DebugViewWrapper />}
        />
        <Route
          path="/session/:sessionId/chunks"
          element={<ChunksPage />}
        />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
