import React, { useState, useEffect } from "react";
import { SessionList } from "./components/SessionList";
import { SessionView } from "./components/SessionView";

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
    sendMessage: (
      sessionId: string,
      content: string
    ) => Promise<{ success: boolean }>;
    delete: (sessionId: string) => Promise<boolean>;
    navigate: (sessionId: string, url: string) => Promise<{ success: boolean }>;
    showView: (sessionId: string | null) => Promise<{ success: boolean }>;
    updateViewBounds: (
      sessionId: string,
      bounds: { x: number; y: number; width: number; height: number }
    ) => Promise<{ success: boolean }>;
  };
  on: (channel: string, callback: (...args: any[]) => void) => void;
  off: (channel: string, callback: (...args: any[]) => void) => void;
  [key: string]: any; // Allow other properties
}

// Use type assertion - electronAPI is already declared in preload

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

  // Load selected session details and show BrowserView
  useEffect(() => {
    const electronAPI = (window as any).electronAPI as ElectronAPIWithSessions;
    if (!electronAPI?.sessions) return;

    const loadSession = async () => {
      if (selectedSessionId) {
        try {
          const session = await electronAPI.sessions.get(selectedSessionId);
          if (session) {
            setSelectedSession(session);
            // Show the BrowserView for this session
            await electronAPI.sessions.showView(selectedSessionId);

            // Give React a moment to render, then trigger bounds update
            // This ensures the SessionView component has mounted and measured its div
            setTimeout(() => {
              // The ResizeObserver in SessionView will handle the bounds update
              // But we can also trigger it manually here as a fallback
              const viewportElement = document.querySelector(
                "[data-browser-viewport]"
              ) as HTMLElement;
              if (viewportElement) {
                const rect = viewportElement.getBoundingClientRect();
                electronAPI.sessions.updateViewBounds(selectedSessionId, {
                  x: Math.round(rect.left),
                  y: Math.round(rect.top),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                });
              }
            }, 100);
          }
        } catch (error) {
          console.error("Failed to load session:", error);
        }
      } else {
        // Hide all BrowserViews when no session is selected
        await electronAPI.sessions.showView(null);
        setSelectedSession(null);
      }
    };
    loadSession();
  }, [selectedSessionId]);

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
    } catch (error) {
      console.error("Failed to create session:", error);
    }
  };

  const handleSelectSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
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
    if (!electronAPI?.sessions) return;
    try {
      await electronAPI.sessions.sendMessage(selectedSessionId, content);
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
    <div
      className="h-screen w-screen overflow-hidden bg-white"
      style={{
        height: "100vh",
        width: "100vw",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {selectedSession && selectedSessionId ? (
        <SessionView
          session={selectedSession}
          onNavigate={handleNavigate}
          onSendMessage={handleSendMessage}
          onBack={handleBackToSessions}
        />
      ) : (
        <SessionList
          sessions={sessions}
          onCreateSession={handleCreateSession}
          onSelectSession={handleSelectSession}
          onRefresh={handleRefreshSessions}
        />
      )}
    </div>
  );
};

export default App;
