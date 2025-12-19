import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { BrowserWindow } from 'electron';
import { AgentSession, AgentState, SessionCreateRequest, SessionUpdate, MessageRole } from './types';
import { AgentSessionManager } from './AgentSession';
import { TabManager } from '../tabs';

export class AgentManager extends EventEmitter {
  private sessions: Map<string, AgentSessionManager> = new Map();
  private sessionTabMap: Map<string, string> = new Map(); // sessionId -> tabId mapping
  private mainWindow: BrowserWindow;
  private tabManager: TabManager;

  constructor(mainWindow: BrowserWindow, tabManager: TabManager) {
    super();
    this.mainWindow = mainWindow;
    this.tabManager = tabManager;
  }

  async createSession(request: SessionCreateRequest = {}): Promise<AgentSession> {
    const sessionId = uuidv4();
    const sessionManager = new AgentSessionManager(sessionId, request.url);
    
    this.sessions.set(sessionId, sessionManager);

    // Create a BrowserView/tab for this session
    // Always create a tab, even if no URL (will show blank)
    const tabId = await this.tabManager.createTab(request.url);
    // Store tabId mapping separately (not in session object which gets serialized)
    this.sessionTabMap.set(sessionId, tabId);
    const session = sessionManager.getSession()!;
    
    // Emit session created event (send serialized version)
    const serialized = this.serializeSession(session);
    this.emit('session:created', serialized);
    this.mainWindow.webContents.send('agent:session-created', serialized);

    // If initial message provided, process it
    if (request.initialMessage) {
      this.sendMessage(sessionId, request.initialMessage);
    }

    return session;
  }

  getSession(sessionId: string): AgentSession | null {
    const sessionManager = this.sessions.get(sessionId);
    return sessionManager?.getSession() || null;
  }

  getAllSessions(): AgentSession[] {
    return Array.from(this.sessions.values())
      .map(manager => manager.getSession()!)
      .filter(session => session !== null);
  }

  sendMessage(sessionId: string, content: string): void {
    const sessionManager = this.sessions.get(sessionId);
    if (!sessionManager) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const session = sessionManager.getSession()!;
    
    // Add user message
    sessionManager.addMessage(MessageRole.USER, content);
    sessionManager.updateState(AgentState.THINKING);
    this.broadcastSessionUpdate(sessionManager.getSession()!);

    // TODO: Process with AI agent
    // For now, just add a placeholder response
    setTimeout(() => {
      sessionManager.addMessage(MessageRole.ASSISTANT, 'I received your message. AI processing will be implemented here.');
      sessionManager.updateState(AgentState.IDLE);
      this.broadcastSessionUpdate(sessionManager.getSession()!);
    }, 500);
  }

  updateSessionState(sessionId: string, state: AgentState): void {
    const sessionManager = this.sessions.get(sessionId);
    if (!sessionManager) return;

    sessionManager.updateState(state);
    this.broadcastSessionUpdate(sessionManager.getSession()!);
  }

  deleteSession(sessionId: string): boolean {
    const sessionManager = this.sessions.get(sessionId);
    if (!sessionManager) return false;

    // Clean up tab mapping
    this.sessionTabMap.delete(sessionId);

    sessionManager.destroy();
    this.sessions.delete(sessionId);

    this.emit('session:deleted', sessionId);
    this.mainWindow.webContents.send('agent:session-deleted', sessionId);

    return true;
  }

  getTabId(sessionId: string): string | null {
    return this.sessionTabMap.get(sessionId) || null;
  }

  private serializeSession(session: AgentSession): AgentSession {
    // Use JSON to create a clean, serializable copy
    // This removes any non-serializable properties like tabId, functions, etc.
    const serialized = JSON.parse(JSON.stringify(session));
    // Explicitly remove tabId if it exists (it's only for main process)
    if ((serialized as any).tabId) {
      delete (serialized as any).tabId;
    }
    return serialized as AgentSession;
  }

  broadcastSessionUpdate(session: AgentSession): void {
    // Emit to main process listeners (can use original)
    this.emit('session:updated', session);
    
    // Send to renderer via IPC (must be serializable)
    const serialized = this.serializeSession(session);
    this.mainWindow.webContents.send('agent:session-updated', serialized);
  }

  // Clean up on window close
  destroy(): void {
    this.sessions.forEach(manager => manager.destroy());
    this.sessions.clear();
    this.removeAllListeners();
  }
}

