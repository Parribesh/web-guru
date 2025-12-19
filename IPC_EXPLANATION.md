# How Electron IPC Works Internally

## The Key Point: IPC is NOT stdin/stdout

Electron IPC uses **Chromium's internal message passing system**, not standard Node.js stdin/stdout.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Electron App                         │
│                                                         │
│  ┌──────────────────┐         ┌──────────────────┐  │
│  │  Main Process     │         │  Renderer Process│  │
│  │  (Node.js)        │◄───────►│  (Chromium)      │  │
│  │                   │   IPC   │                   │  │
│  │  ipcMain.handle()  │◄───────►│  ipcRenderer      │  │
│  │                   │         │  .invoke()        │  │
│  └──────────────────┘         └──────────────────┘  │
│         ▲                                  ▲           │
│         │                                  │           │
│         └────────── Electron's ────────────┘           │
│              Internal IPC Bridge                       │
│         (Chromium's Message Passing)                  │
└─────────────────────────────────────────────────────────┘
```

## How `ipcRenderer.invoke()` Works

1. **Renderer calls**: `ipcRenderer.invoke('agent:create-session', request)`
2. **Electron's IPC bridge**:
   - Serializes the message (JSON.stringify)
   - Sends it through Chromium's internal message channel
   - NOT stdin/stdout - uses Chromium's IPC mechanism
3. **Main process receives**:
   - Electron's IPC layer deserializes the message
   - Routes it to `ipcMain.handle('agent:create-session', ...)`
   - Executes the handler
4. **Response flows back**:
   - Handler returns a value
   - Electron serializes and sends it back
   - `ipcRenderer.invoke()` resolves with the result

## Why Terminal Can't Use IPC

```
Terminal Process (external)
    │
    │ ❌ Can't access Electron's IPC bridge
    │    (not part of Electron process)
    │
    ▼
Need a bridge:
  - File watching (current approach)
  - HTTP server
  - WebSocket
  - Named pipes
```

## The IPC Bridge is Internal

- Only works between Electron processes (main ↔ renderer)
- Uses Chromium's message passing (not Node.js IPC)
- Requires Electron process context
- External processes can't access it directly

