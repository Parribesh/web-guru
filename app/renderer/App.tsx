import React, { useState, useEffect } from 'react';
import { TabBar } from './components/TabBar';
import { AddressBar } from './components/AddressBar';
import { AISidePanel } from './ai-ui/AISidePanel';
import { CommandPalette } from './ai-ui/CommandPalette';
import { Tab, AIRequest, AIResponse } from '../shared/types';
import './App.css';

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

  // Initialize tabs on mount
  useEffect(() => {
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

  const handleAIRequest = async (request: AIRequest) => {
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
    } catch (error) {
      console.error('AI request failed:', error);
      setCurrentAIResponse({
        success: false,
        content: '',
        error: 'AI service unavailable'
      });
    } finally {
      setIsAIProcessing(false);
    }
  };

  const activeTab = tabs.find(tab => tab.id === activeTabId);

  return (
    <div className="app">
      <div className="title-bar">
        <div className="window-controls">
          <button onClick={() => window.electronAPI.window.minimize()} className="window-btn minimize">─</button>
          <button onClick={() => window.electronAPI.window.maximize()} className="window-btn maximize">□</button>
          <button onClick={() => window.electronAPI.window.close()} className="window-btn close">✕</button>
        </div>
      </div>

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

      <div className="browser-content">
        {/* BrowserView will be rendered here by Electron */}
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
