"use strict";
// Shared types for Electron AI Browser
Object.defineProperty(exports, "__esModule", { value: true });
exports.IPCChannels = void 0;
// IPC Channel definitions
var IPCChannels;
(function (IPCChannels) {
    // Tab management
    IPCChannels["CREATE_TAB"] = "tab:create";
    IPCChannels["CLOSE_TAB"] = "tab:close";
    IPCChannels["SWITCH_TAB"] = "tab:switch";
    IPCChannels["UPDATE_TAB"] = "tab:update";
    // Navigation
    IPCChannels["NAVIGATE"] = "navigate";
    IPCChannels["GO_BACK"] = "go-back";
    IPCChannels["GO_FORWARD"] = "go-forward";
    IPCChannels["RELOAD"] = "reload";
    IPCChannels["STOP_LOADING"] = "stop-loading";
    // AI services
    IPCChannels["AI_REQUEST"] = "ai:request";
    IPCChannels["AI_RESPONSE"] = "ai:response";
    // DOM extraction
    IPCChannels["EXTRACT_DOM"] = "dom:extract";
    IPCChannels["DOM_CONTENT"] = "dom:content";
    // Window management
    IPCChannels["WINDOW_MINIMIZE"] = "window:minimize";
    IPCChannels["WINDOW_MAXIMIZE"] = "window:maximize";
    IPCChannels["WINDOW_CLOSE"] = "window:close";
    IPCChannels["WINDOW_RESIZE"] = "window:resize";
    // Dev tools
    IPCChannels["OPEN_DEV_TOOLS"] = "dev-tools:open";
    IPCChannels["CLOSE_DEV_TOOLS"] = "dev-tools:close";
})(IPCChannels || (exports.IPCChannels = IPCChannels = {}));
//# sourceMappingURL=types.js.map