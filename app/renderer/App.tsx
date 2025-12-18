import React, { useState, useEffect } from 'react';
import { TabBar } from './components/TabBar';
import { AddressBar } from './components/AddressBar';
import { AISidePanel } from './ai-ui/AISidePanel';
import { AIChatPanel } from './ai-ui/AIChatPanel';
import { CommandPalette } from './ai-ui/CommandPalette';
import { Tab, AIRequest, AIResponse } from '../shared/types';
import './index.css';

declare global {
  interface Window {
    electronAPI: {
      tabs: {
        create: (url?: string) => Promise<{ tabId: string; tabs: Tab[] }>;
        close: (tabId: string) => Promise<{ success: boolean; tabs: Tab[]; activeTabId: string | null }>;
        switch: (tabId: string) => Promise<{ success: boolean }>;
        getAll: () => Promise<{ tabs: Tab[]; activeTabId: string | null }>;
      };
      navigation: {
        go: (tabId: string, url: string) => Promise<{ success: boolean }>;
        back: (tabId: string) => Promise<{ success: boolean }>;
        forward: (tabId: string) => Promise<{ success: boolean }>;
        reload: (tabId: string) => Promise<{ success: boolean }>;
        stop: (tabId: string) => Promise<{ success: boolean }>;
      };
      ai: {
        request: (request: AIRequest) => Promise<AIResponse>;
      };
      window: {
        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
        close: () => Promise<void>;
      };
      devTools: {
        open: (tabId?: string) => Promise<void>;
      };
      dom: {
        extractContent: () => Promise<string>;
        getSelectedText: () => string;
        getPageInfo: () => { title: string; url: string; selectedText: string };
      };
      on: (channel: string, callback: (...args: any[]) => void) => void;
      off: (channel: string, callback: (...args: any[]) => void) => void;
      sendAppEvent: (eventType: string, data: any) => void;
    };
  }
}

const App: React.FC = () => {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [currentAIResponse, setCurrentAIResponse] = useState<AIResponse | null>(null);
  const [isAIProcessing, setIsAIProcessing] = useState(false);
  const [chatByTab, setChatByTab] = useState<Record<string, { from: 'user' | 'ai'; content: string }[]>>({});

  // Initialize tabs on mount
  useEffect(() => {
    if (!window.electronAPI) {
      console.error('electronAPI not available (preload not loaded?)');
      return;
    }

    const initializeTabs = async () => {
      try {
        const { tabs: initialTabs, activeTabId: initialActiveTabId } =
          await window.electronAPI.tabs.getAll();
        setTabs(initialTabs);
        setActiveTabId(initialActiveTabId);
      } catch (error) {
        console.error('Failed to initialize tabs:', error);
      }
    };

    initializeTabs();

    // Set up IPC listeners
    const handleTabUpdate = (event: any, updatedTab: Tab) => {
      setTabs(prevTabs =>
        prevTabs.map(tab =>
          tab.id === updatedTab.id ? { ...tab, ...updatedTab } : tab
        )
      );
    };

    const handleTabCreated = (event: any, data: { tabId: string; tabs: Tab[] }) => {
      setTabs(data.tabs);
      setActiveTabId(data.tabId);
    };

    const handleTabClosed = (event: any, data: { success: boolean; tabs: Tab[]; activeTabId: string | null }) => {
      if (data.success) {
        setTabs(data.tabs);
        setActiveTabId(data.activeTabId);
      }
    };

    const handleAIPanelToggle = () => {
      setIsAIPanelOpen(prev => !prev);
    };

    const handleCommandPaletteToggle = () => {
      setIsCommandPaletteOpen(prev => !prev);
    };

    // Register listeners
    window.electronAPI.on('tab:update', handleTabUpdate);
    window.electronAPI.on('tab:created', handleTabCreated);
    window.electronAPI.on('tab:closed', handleTabClosed);
    window.electronAPI.on('ai:toggle-panel', handleAIPanelToggle);
    window.electronAPI.on('command-palette:toggle', handleCommandPaletteToggle);

    // Cleanup
    return () => {
      window.electronAPI.off('tab:update', handleTabUpdate);
      window.electronAPI.off('tab:created', handleTabCreated);
      window.electronAPI.off('tab:closed', handleTabClosed);
      window.electronAPI.off('ai:toggle-panel', handleAIPanelToggle);
      window.electronAPI.off('command-palette:toggle', handleCommandPaletteToggle);
    };
  }, []);

  const handleTabClick = async (tabId: string) => {
    try {
      await window.electronAPI.tabs.switch(tabId);
      setActiveTabId(tabId);
      if (!chatByTab[tabId]) {
        setChatByTab(prev => ({ ...prev, [tabId]: [] }));
      }
    } catch (error) {
      console.error('Failed to switch tab:', error);
    }
  };

  const handleTabClose = async (tabId: string) => {
    try {
      const result = await window.electronAPI.tabs.close(tabId);
      if (result.success) {
        setTabs(result.tabs);
        setActiveTabId(result.activeTabId);
      }
    } catch (error) {
      console.error('Failed to close tab:', error);
    }
  };

  const handleNewTab = async () => {
    try {
      const result = await window.electronAPI.tabs.create();
      setTabs(result.tabs);
      setActiveTabId(result.tabId);
      setChatByTab(prev => ({ ...prev, [result.tabId]: [] }));
    } catch (error) {
      console.error('Failed to create tab:', error);
    }
  };

  const handleNavigate = async (url: string) => {
    if (!activeTabId) return;

    try {
      await window.electronAPI.navigation.go(activeTabId, url);
    } catch (error) {
      console.error('Failed to navigate:', error);
    }
  };

  const handleBack = async () => {
    if (!activeTabId) return;

    try {
      await window.electronAPI.navigation.back(activeTabId);
    } catch (error) {
      console.error('Failed to go back:', error);
    }
  };

  const handleForward = async () => {
    if (!activeTabId) return;

    try {
      await window.electronAPI.navigation.forward(activeTabId);
    } catch (error) {
      console.error('Failed to go forward:', error);
    }
  };

  const handleReload = async () => {
    if (!activeTabId) return;

    try {
      await window.electronAPI.navigation.reload(activeTabId);
    } catch (error) {
      console.error('Failed to reload:', error);
    }
  };

  const handleStop = async () => {
    if (!activeTabId) return;

    try {
      await window.electronAPI.navigation.stop(activeTabId);
    } catch (error) {
      console.error('Failed to stop loading:', error);
    }
  };

  const appendChat = (tabId: string, from: 'user' | 'ai', content: string) => {
    setChatByTab(prev => ({
      ...prev,
      [tabId]: [...(prev[tabId] || []), { from, content }]
    }));
  };

  const handleAIRequest = async (request: AIRequest): Promise<AIResponse | null> => {
    setIsAIProcessing(true);
    setCurrentAIResponse(null);

    try {
      // Add context from current page if available
      const pageInfo = window.electronAPI.dom.getPageInfo();
      const enhancedRequest: AIRequest = {
        ...request,
        context: {
          url: pageInfo.url,
          title: pageInfo.title,
          selectedText: pageInfo.selectedText,
        }
      };

      const response = await window.electronAPI.ai.request(enhancedRequest);
      setCurrentAIResponse(response);
      if (activeTabId) {
        if (response.success) {
          appendChat(activeTabId, 'ai', response.content);
        } else if (response.error) {
          appendChat(activeTabId, 'ai', `Error: ${response.error}`);
        }
      }
      return response;
    } catch (error) {
      console.error('AI request failed:', error);
      setCurrentAIResponse({
        success: false,
        content: '',
        error: 'AI service unavailable'
      });
      if (activeTabId) {
        appendChat(activeTabId, 'ai', 'Error: AI service unavailable');
      }
      return {
        success: false,
        content: '',
        error: 'AI service unavailable'
      };
    } finally {
      setIsAIProcessing(false);
    }
  };

  const handleChatSend = async (text: string): Promise<AIResponse | null> => {
    if (!activeTabId) return null;
    appendChat(activeTabId, 'user', text);
    const request: AIRequest = { type: 'chat', content: text };
    return handleAIRequest(request);
  };

  const activeTab = tabs.find(tab => tab.id === activeTabId);
  const activeChat = activeTabId ? chatByTab[activeTabId] || [] : [];

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <div className="h-8 bg-gray-100 border-b border-gray-200 flex items-center justify-end px-2 select-none">
        <div className="flex space-x-1">
          <button onClick={() => window.electronAPI.window.minimize()} className="w-10 h-8 flex items-center justify-center text-gray-600 hover:bg-gray-200 rounded">─</button>
          <button onClick={() => window.electronAPI.window.maximize()} className="w-10 h-8 flex items-center justify-center text-gray-600 hover:bg-gray-200 rounded">□</button>
          <button onClick={() => window.electronAPI.window.close()} className="w-10 h-8 flex items-center justify-center text-red-600 hover:bg-red-100 rounded">✕</button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 bg-gray-100">
        <div className="flex-1 relative min-w-0 bg-black">
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-xs pointer-events-none">
            Browser View (Electron) overlays this area
          </div>
        </div>

        <div className="w-[420px] min-w-[360px] max-w-[520px] flex flex-col bg-white border-l border-gray-200">
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId || ''}
            onTabClick={handleTabClick}
            onTabClose={handleTabClose}
            onNewTab={handleNewTab}
          />

          <AddressBar
            url={activeTab?.url || ''}
            isLoading={activeTab?.isLoading || false}
            canGoBack={activeTab?.canGoBack || false}
            canGoForward={activeTab?.canGoForward || false}
            onNavigate={handleNavigate}
            onBack={handleBack}
            onForward={handleForward}
            onReload={handleReload}
            onStop={handleStop}
          />

          <AIChatPanel
            messages={activeChat}
            onSend={handleChatSend}
            isProcessing={isAIProcessing}
            hasActiveTab={!!activeTabId}
          />
        </div>
      </div>

      <AISidePanel
        isOpen={isAIPanelOpen}
        onToggle={() => setIsAIPanelOpen(!isAIPanelOpen)}
        onRequest={handleAIRequest}
        currentResponse={currentAIResponse || undefined}
        isProcessing={isAIProcessing}
      />

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onCommand={(command) => {
          // TODO: Implement command execution
          console.log('Command executed:', command);
          setIsCommandPaletteOpen(false);
        }}
      />
    </div>
  );
};

export default App;
