import { app, BrowserWindow, Menu, dialog, globalShortcut } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as net from "net";
import { setupIPC, getTabManager, getAgentManager } from "./ipc";
import { createMainWindow } from "./windows";
import { setupAIService } from "./ai";
import { eventLogger } from "./logging/event-logger";

let mainWindow: BrowserWindow | null = null;

// Security: Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.on("ready", async () => {
  // Set up application menu
  setupApplicationMenu();

  // Create main window
  mainWindow = createMainWindow();

  // Set up event logger
  eventLogger.setMainWindow(mainWindow);
  eventLogger.info("App", "Application starting...");

  // Reset main window zoom to 1.0 on startup
  mainWindow.webContents.on("did-finish-load", () => {
    console.log("🖼️ React UI loaded, resetting zoom to 1.0");
    mainWindow!.webContents.setZoomFactor(1.0);
    mainWindow!.webContents.invalidate();
    eventLogger.success("App", "React UI loaded successfully");
  });

  // Set up IPC handlers
  const { tabManager, agentManager, handleCreateSession } =
    setupIPC(mainWindow);

  // Make managers and mainWindow globally accessible
  (globalThis as any).tabsManager = tabManager;
  (globalThis as any).agentManager = agentManager;
  (globalThis as any).mainWindow = mainWindow;

  // Initialize AI service
  await setupAIService();

  // Register global shortcuts (after tabsManager is available)
  setupGlobalShortcuts();

  // Set up CLI server for command-line interface
  setupCLIServer(handleCreateSession);

  // Handle app events
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // On macOS, keep app running even when all windows are closed
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  // Unregister global shortcuts
  globalShortcut.unregisterAll();

  // Clean up resources
  if (mainWindow) {
    mainWindow.destroy();
    mainWindow = null;
  }
});

// Security: Prevent navigation to external protocols
app.on("web-contents-created", (event, contents) => {
  contents.on("will-navigate", (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      event.preventDefault();
    }
  });

  contents.on("will-navigate", (event, navigationUrl) => {
    // Additional check for navigation events
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      event.preventDefault();
    }
  });
});

function setupApplicationMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        {
          label: "New Tab",
          accelerator: "CmdOrCtrl+T",
          click: () => {
            mainWindow?.webContents.send("tab:create");
          },
        },
        {
          label: "Close Tab",
          accelerator: "CmdOrCtrl+W",
          click: () => {
            mainWindow?.webContents.send("tab:close");
          },
        },
        { type: "separator" },
        {
          label: "Quit",
          accelerator: process.platform === "darwin" ? "Cmd+Q" : "Ctrl+Q",
          click: () => {
            app.quit();
          },
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Toggle AI Panel",
          accelerator: "CmdOrCtrl+Shift+A",
          click: () => {
            mainWindow?.webContents.send("ai:toggle-panel");
          },
        },
        {
          label: "Command Palette",
          accelerator: "CmdOrCtrl+K",
          click: () => {
            mainWindow?.webContents.send("command-palette:toggle");
          },
        },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        {
          label: "Reset Zoom",
          accelerator: "CmdOrCtrl+0",
          click: () => {
            console.log("Reset Zoom menu clicked");
            handleZoomReset();
          },
        },
        {
          label: "Zoom In",
          accelerator: "CmdOrCtrl+=",
          click: () => {
            console.log("Zoom In menu clicked");
            handleZoom(0.1);
          },
        },
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+-",
          click: () => {
            console.log("Zoom Out menu clicked");
            handleZoom(-0.1);
          },
        },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "close" }],
    },
  ];

  // macOS specific menu
  if (process.platform === "darwin") {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services", submenu: [] },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function handleZoom(delta: number) {
  console.log(
    `🎮 Zoom ${delta > 0 ? "IN" : "OUT"} handler called with delta: ${delta}`
  );

  // Zoom the React UI (main window)
  if (mainWindow) {
    const currentZoom = mainWindow.webContents.getZoomFactor();
    const newZoom =
      delta > 0
        ? Math.min(currentZoom + delta, 5.0)
        : Math.max(currentZoom + delta, 0.1);
    console.log(`🖼️ React UI zoom: ${currentZoom} → ${newZoom}`);
    mainWindow.webContents.setZoomFactor(newZoom);
    mainWindow.webContents.invalidate();
  }

  // Zoom the BrowserView (web content)
  const tabsManager = getTabManager();
  if (tabsManager) {
    console.log(`🎯 Calling zoomActiveTab with delta: ${delta}`);
    const success = tabsManager.zoomActiveTab(delta);
    console.log(`✅ BrowserView zoom operation result: ${success}`);
  } else {
    console.log("❌ tabsManager not available");
  }
}

function handleZoomReset() {
  console.log("🔄 Zoom reset handler called");

  // Reset React UI (main window) zoom
  if (mainWindow) {
    const currentZoom = mainWindow.webContents.getZoomFactor();
    console.log(`🖼️ Resetting React UI zoom from ${currentZoom} to 1.0`);
    mainWindow.webContents.setZoomFactor(1.0);
    mainWindow.webContents.invalidate();
  }

  // Reset BrowserView (web content) zoom
  const tabsManager = getTabManager();
  if (tabsManager) {
    const success = tabsManager.resetZoomActiveTab();
    console.log(`✅ BrowserView zoom reset success: ${success}`);
  } else {
    console.log("❌ tabsManager not available");
  }
}

function setupCLIServer(handleCreateSession: any) {
  const CLI_PORT = 9876;
  const server = net.createServer((socket) => {
    console.log('📡 CLI client connected');

    let buffer = '';

    socket.on('data', async (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const command = JSON.parse(line);
          console.log('📨 CLI command received:', command.type);

          let response: any = { success: false };

          try {
            if (command.type === 'create-session') {
              if (!handleCreateSession) {
                response = { success: false, error: 'handleCreateSession not available' };
              } else {
                const fakeEvent = { sender: mainWindow?.webContents } as any;
                const session = await handleCreateSession(fakeEvent, {
                  url: command.url,
                  initialMessage: command.initialMessage,
                });
                response = {
                  success: true,
                  data: `Session created: ${session.id}\nTitle: ${session.title}\nURL: ${session.url || 'none'}`,
                };
              }
            } else if (command.type === 'list-sessions') {
              const agentManager = getAgentManager();
              if (!agentManager) {
                response = { success: false, error: 'AgentManager not available' };
              } else {
                const sessions = agentManager.getAllSessions();
                response = {
                  success: true,
                  data: sessions.map((s) => ({
                    id: s.id,
                    title: s.title,
                    url: s.url,
                    state: s.state,
                    messages: s.messages.length,
                  })),
                };
              }
            } else if (command.type === 'ask-question') {
              const agentManager = getAgentManager();
              if (!agentManager) {
                response = { success: false, error: 'AgentManager not available' };
              } else {
                const session = agentManager.getSession(command.sessionId);
                if (!session) {
                  response = { success: false, error: `Session not found: ${command.sessionId}` };
                } else {
                  const qaResponse = await agentManager.askQuestion(
                    command.sessionId,
                    command.question
                  );
                  if (qaResponse.success) {
                    response = {
                      success: true,
                      data: `Answer: ${qaResponse.answer}\nUsed ${qaResponse.relevantChunks?.length || 0} relevant chunk(s)`,
                    };
                  } else {
                    response = { success: false, error: qaResponse.error || 'Failed to get answer' };
                  }
                }
              }
            } else {
              response = { success: false, error: `Unknown command type: ${command.type}` };
            }
          } catch (error: any) {
            response = { success: false, error: error.message || 'Unknown error' };
          }

          socket.write(JSON.stringify(response) + '\n');
        } catch (parseError) {
          socket.write(JSON.stringify({ success: false, error: 'Invalid JSON' }) + '\n');
        }
      }
    });

    socket.on('end', () => {
      console.log('📡 CLI client disconnected');
    });

    socket.on('error', (err) => {
      console.error('CLI socket error:', err);
    });
  });

  server.listen(CLI_PORT, '127.0.0.1', () => {
    console.log(`✅ CLI server listening on port ${CLI_PORT}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️ CLI port ${CLI_PORT} already in use`);
    } else {
      console.error('CLI server error:', err);
    }
  });
}

function setupGlobalShortcuts() {
  console.log("Setting up global shortcuts");

  // Zoom shortcuts - try multiple accelerator formats
  const zoomInRegistered1 = globalShortcut.register(
    "CommandOrControl+=",
    () => {
      console.log(
        "🚀 Global Zoom In (=) shortcut triggered at:",
        new Date().toISOString()
      );
      handleZoom(0.1);
    }
  );
  console.log("Zoom In (=) shortcut registered:", zoomInRegistered1);

  const zoomInRegistered2 = globalShortcut.register(
    "CommandOrControl+Plus",
    () => {
      console.log("Global Zoom In (Plus) shortcut triggered");
      handleZoom(0.1);
    }
  );
  console.log("Zoom In (Plus) shortcut registered:", zoomInRegistered2);

  const zoomInRegistered3 = globalShortcut.register(
    "CommandOrControl+Shift+=",
    () => {
      console.log("Global Zoom In (Shift+=) shortcut triggered");
      handleZoom(0.1);
    }
  );
  console.log("Zoom In (Shift+=) shortcut registered:", zoomInRegistered3);

  globalShortcut.register("CommandOrControl+Plus", () => {
    console.log("Global Zoom In (Plus) shortcut triggered");
    const tabsManager = getTabManager();
    const activeTabId = tabsManager?.getActiveTabId();
    if (activeTabId && tabsManager) {
      const activeView = (tabsManager as any).views?.get(activeTabId);
      if (activeView) {
        const currentZoom = activeView.webContents.getZoomFactor();
        activeView.webContents.setZoomFactor(Math.min(currentZoom + 0.1, 5.0));
      }
    }
  });

  // Try different accelerator formats for zoom out - prioritize regular minus
  const accelerators = [
    "CommandOrControl+-",
    "Minus", // Try just the key
    "CommandOrControl+Minus",
    "CommandOrControl+numsub",
    "CommandOrControl+numsubtract",
    "Ctrl+-",
    "Cmd+-",
  ];

  for (const accel of accelerators) {
    try {
      const registered = globalShortcut.register(accel, () => {
        console.log(
          `🚫 Global Zoom Out shortcut triggered with ${accel} at ${new Date().toISOString()}`
        );
        handleZoom(-0.1);
      });
      console.log(`Zoom Out shortcut ${accel} registered: ${registered}`);
      if (registered) {
        console.log(`✅ Using Zoom Out accelerator: ${accel}`);
        break; // Use the first one that works
      } else {
        console.log(`❌ Failed to register Zoom Out accelerator: ${accel}`);
      }
    } catch (error) {
      console.log(
        `Failed to register ${accel}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  const resetZoomRegistered = globalShortcut.register(
    "CommandOrControl+0",
    () => {
      console.log("Global Reset Zoom shortcut triggered");
      handleZoomReset();
    }
  );
  console.log("Reset Zoom shortcut registered:", resetZoomRegistered);
}
