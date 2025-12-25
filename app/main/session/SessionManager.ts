// Session Manager - Manages all agent sessions and their associated tabs

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { BrowserWindow } from 'electron';
import { AgentSession, SessionCreateRequest } from '../agent/types';
import { AgentSessionState } from '../agent/AgentSessionState';
import { TabManager } from '../tabs';
import { AgentManager } from '../agent/AgentManager';
import { IPCChannels } from '../../shared/types';

export class SessionManager extends EventEmitter {
  private sessions: Map<string, {
    sessionState: AgentSessionState;
    agentManager: AgentManager;
    tabId: string;
  }> = new Map();
  private mainWindow: BrowserWindow;
  private tabManager: TabManager;

  constructor(mainWindow: BrowserWindow, tabManager: TabManager) {
    super();
    this.mainWindow = mainWindow;
    this.tabManager = tabManager;
  }

  async createSession(request: SessionCreateRequest = {}): Promise<AgentSession> {
    const sessionId = uuidv4();
    const sessionState = new AgentSessionState(sessionId, request.url);
    
    // Create a BrowserView/tab for this session
    const tabId = await this.tabManager.createTab(request.url);
    
    // Create session-specific AgentManager
    const agentManager = new AgentManager(sessionId, tabId, this.tabManager, sessionState);
    agentManager.setBroadcastCallback((session) => this.broadcastSessionUpdate(session));
    
    // Store session data
    this.sessions.set(sessionId, {
      sessionState,
      agentManager,
      tabId,
    });
    
    const session = sessionState.getSession()!;
    
    // Emit session created event
    const serialized = this.serializeSession(session);
    this.emit('session:created', serialized);
    this.mainWindow.webContents.send(IPCChannels.events.sessionCreated, serialized);

    // If initial message provided, process it
    if (request.initialMessage) {
      await agentManager.askQuestion(request.initialMessage);
    }

    return session;
  }

  getSession(sessionId: string): AgentSession | null {
    const sessionData = this.sessions.get(sessionId);
    return sessionData?.sessionState.getSession() || null;
  }

  getAgentManager(sessionId: string): AgentManager | null {
    return this.sessions.get(sessionId)?.agentManager || null;
  }

  getTabId(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.tabId || null;
  }

  getSessionIdByTabId(tabId: string): string | null {
    for (const [sessionId, sessionData] of this.sessions.entries()) {
      if (sessionData.tabId === tabId) {
        return sessionId;
      }
    }
    return null;
  }

  getAllSessions(): AgentSession[] {
    return Array.from(this.sessions.values())
      .map(data => data.sessionState.getSession()!)
      .filter(session => session !== null);
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const sessionData = this.sessions.get(sessionId);
    if (!sessionData) {
      return false;
    }

    // Close the associated tab
    await this.tabManager.closeTab(sessionData.tabId);
    
    // Destroy session
    sessionData.sessionState._destroy();
    
    // Remove from map
    this.sessions.delete(sessionId);
    
    // Emit session deleted event
    this.emit('session:deleted', sessionId);
    this.mainWindow.webContents.send(IPCChannels.events.sessionDeleted, sessionId);
    
    return true;
  }

  private serializeSession(session: AgentSession): any {
    // Remove any non-serializable data
    const serialized = JSON.parse(JSON.stringify(session));
    return serialized;
  }

  broadcastSessionUpdate(session: AgentSession): void {
    // Emit to main process listeners
    this.emit('session:updated', session);
    
    // Send to renderer via IPC
    const serialized = this.serializeSession(session);
    this.mainWindow.webContents.send(IPCChannels.events.sessionUpdated, serialized);
  }
}
