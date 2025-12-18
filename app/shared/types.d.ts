export interface Tab {
    id: string;
    url: string;
    title: string;
    favicon?: string;
    isLoading: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
}
export interface BrowserViewConfig {
    url: string;
    partition?: string;
    webSecurity?: boolean;
    nodeIntegration?: boolean;
    contextIsolation?: boolean;
    preload?: string;
}
export interface AIServiceConfig {
    provider: 'openai' | 'anthropic' | 'local' | 'mock';
    apiKey?: string;
    model?: string;
    endpoint?: string;
}
export interface AIRequest {
    type: 'summarize' | 'analyze' | 'chat' | 'extract';
    content: string;
    context?: {
        url: string;
        title: string;
        selectedText?: string;
    };
    options?: Record<string, any>;
}
export interface AIResponse {
    success: boolean;
    content: string;
    metadata?: {
        tokens?: number;
        model?: string;
        processingTime?: number;
    };
    error?: string;
}
export declare enum IPCChannels {
    CREATE_TAB = "tab:create",
    CLOSE_TAB = "tab:close",
    SWITCH_TAB = "tab:switch",
    UPDATE_TAB = "tab:update",
    NAVIGATE = "navigate",
    GO_BACK = "go-back",
    GO_FORWARD = "go-forward",
    RELOAD = "reload",
    STOP_LOADING = "stop-loading",
    AI_REQUEST = "ai:request",
    AI_RESPONSE = "ai:response",
    EXTRACT_DOM = "dom:extract",
    DOM_CONTENT = "dom:content",
    WINDOW_MINIMIZE = "window:minimize",
    WINDOW_MAXIMIZE = "window:maximize",
    WINDOW_CLOSE = "window:close",
    WINDOW_RESIZE = "window:resize",
    OPEN_DEV_TOOLS = "dev-tools:open",
    CLOSE_DEV_TOOLS = "dev-tools:close"
}
export interface IPCMessage<T = any> {
    channel: IPCChannels;
    data: T;
}
export interface PageLoadEvent {
    tabId: string;
    url: string;
    title: string;
    isLoading: boolean;
}
export interface DOMContentEvent {
    tabId: string;
    content: string;
    url: string;
    title: string;
}
export interface Command {
    id: string;
    label: string;
    description?: string;
    shortcut?: string;
    action: () => void;
    category?: string;
}
export interface CommandPaletteState {
    isOpen: boolean;
    query: string;
    commands: Command[];
    filteredCommands: Command[];
    selectedIndex: number;
}
export interface TabBarProps {
    tabs: Tab[];
    activeTabId: string;
    onTabClick: (tabId: string) => void;
    onTabClose: (tabId: string) => void;
    onNewTab: () => void;
}
export interface AddressBarProps {
    url: string;
    isLoading: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
    onNavigate: (url: string) => void;
    onBack: () => void;
    onForward: () => void;
    onReload: () => void;
    onStop: () => void;
}
export interface AISidePanelProps {
    isOpen: boolean;
    onToggle: () => void;
    onRequest: (request: AIRequest) => void;
    currentResponse?: AIResponse;
    isProcessing: boolean;
}
//# sourceMappingURL=types.d.ts.map