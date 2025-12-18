# AI Browser

A cross-platform Electron desktop application that acts as an AI-enhanced browser built with Chromium, featuring real-time AI integration, secure IPC communication, and a modern React UI.

## Features

- **Chromium-based browsing** with secure BrowserView isolation
- **AI integration** via preload script for DOM content analysis
- **Tab management** with isolated sessions per tab
- **Secure IPC** communication between main and renderer processes
- **React UI** with modern components
- **Command palette** for quick actions
- **AI side panel** for content analysis and chat

## Project Structure

```
app/
├── main/           # Electron main process
│   ├── index.ts    # App entry point
│   ├── windows.ts  # Window & BrowserView management
│   ├── tabs.ts     # Tab logic and management
│   ├── ai/         # AI service integration
│   │   ├── index.ts
│   │   └── prompts.ts
│   └── ipc.ts      # IPC channels and handlers
├── preload/
│   └── index.ts    # DOM extraction and secure bridges
├── renderer/       # React renderer process
│   ├── App.tsx     # React root component
│   ├── App.css     # Styles
│   ├── components/ # UI components
│   ├── pages/      # Page components
│   └── ai-ui/      # AI-specific UI components
└── shared/
    └── types.ts    # Shared TypeScript types
```

## Security Features

- `contextIsolation: true` - Prevents script contamination
- `nodeIntegration: false` - No direct Node.js access in renderer
- Sandboxed BrowserViews for content isolation
- Allowlist-based IPC channels
- Secure preload script for DOM access

## Development Setup

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Development mode (builds and runs concurrently)
npm run dev

# Production build
npm run build

# Run production build
npm start

# Package for distribution
npm run dist
```

### Development Workflow

1. **Main Process**: `npm run dev:main` - Compiles TypeScript in watch mode
2. **Renderer Process**: `npm run dev:renderer` - Webpack dev server with hot reload
3. **Full App**: `npm run dev` - Runs both processes concurrently

## Key Components

### Main Process
- **Window Management**: Creates and manages BrowserWindows and BrowserViews
- **Tab System**: Handles tab creation, switching, and lifecycle
- **IPC Handlers**: Secure communication channels
- **AI Service**: Placeholder for AI API integration

### Preload Script
- **DOM Extraction**: Safely extracts page content for AI analysis
- **IPC Bridge**: Provides secure API to renderer
- **Event Handling**: Keyboard shortcuts and page events

### Renderer Process
- **React UI**: Modern component-based interface
- **Tab Bar**: Visual tab management
- **Address Bar**: URL input and navigation controls
- **AI Panel**: Chat and analysis interface
- **Command Palette**: Quick action launcher

## TODOs for Future Development

### AI Integration
- [ ] Implement actual AI API integration (OpenAI, Anthropic, Local AI)
- [ ] Add content summarization
- [ ] Implement chat functionality
- [ ] Add content analysis features

### UI/UX Improvements
- [ ] Implement dark mode
- [ ] Add bookmarks and history
- [ ] Improve responsive design
- [ ] Add keyboard navigation

### Security & Performance
- [ ] Add content security policy
- [ ] Implement session management
- [ ] Add performance monitoring
- [ ] Implement caching strategies

### Advanced Features
- [ ] Add extension system
- [ ] Implement sync across devices
- [ ] Add collaborative features
- [ ] Implement offline mode

## Building for Production

```bash
# Build all processes
npm run build

# Create distributable packages
npm run dist
```

This will create platform-specific packages in the `release/` directory.

## Contributing

1. Follow the existing TypeScript patterns
2. Maintain security best practices
3. Add tests for new features
4. Update documentation

## License

MIT License - see LICENSE file for details.
