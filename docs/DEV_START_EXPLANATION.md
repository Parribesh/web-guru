# Understanding `dev:start` Script

## Full Command Breakdown

```bash
npm run build:main && npm run build:preload && concurrently --kill-others-on-fail --names "webpack,electron" "npm run dev:renderer" "wait-on http://localhost:3000 && NODE_ENV=development ELECTRON_NO_DETACH=1 npx electron dist/main/main/index.js"
```

## Step-by-Step Explanation

### Part 1: Build Steps (Sequential - `&&` means "run next only if previous succeeds")

1. **`npm run build:main`**
   - Compiles TypeScript main process code
   - Output: `dist/main/main/index.js`
   - **Why first?** Electron needs the main process to start

2. **`npm run build:preload`**
   - Compiles TypeScript preload script
   - Output: `dist/preload/preload/index.js`
   - **Why second?** Main process needs preload script path

### Part 2: Concurrent Execution (`concurrently` runs multiple commands in parallel)

**`concurrently`** - Runs multiple npm scripts at the same time

**Options:**
- `--kill-others-on-fail` - If one process fails, kill all others
- `--names "webpack,electron"` - Label the output so you know which is which

**Two parallel processes:**

#### Process 1: `"npm run dev:renderer"`
- Starts webpack dev server
- Serves React app at `http://localhost:3000`
- Hot reload enabled (auto-refresh on file changes)
- **Runs continuously** (doesn't exit)

#### Process 2: `"wait-on http://localhost:3000 && NODE_ENV=development ELECTRON_NO_DETACH=1 npx electron dist/main/main/index.js"`

**Step 2a: `wait-on http://localhost:3000`**
- Waits for webpack dev server to be ready
- Polls `http://localhost:3000` until it responds
- **Why?** Electron shouldn't start until React app is ready

**Step 2b: `NODE_ENV=development`**
- Sets environment variable
- Tells Electron to load `http://localhost:3000` instead of built files

**Step 2c: `ELECTRON_NO_DETACH=1`**
- Prevents Electron from detaching from terminal
- Keeps it in the same terminal session

**Step 2d: `npx electron dist/main/main/index.js`**
- Launches Electron with the compiled main process
- Electron loads the React app from `http://localhost:3000`

## Visual Flow

```
1. Build main process (TypeScript → JavaScript)
   ↓
2. Build preload script (TypeScript → JavaScript)
   ↓
3. Start TWO processes in parallel:
   
   Process A: Webpack Dev Server
   ├─ Serves React app at localhost:3000
   ├─ Watches for file changes
   └─ Hot reloads on changes
   
   Process B: Wait + Launch Electron
   ├─ Wait for localhost:3000 to be ready
   ├─ Launch Electron
   └─ Electron loads React from localhost:3000
```

## Why This Setup?

- **Development mode**: React runs on webpack dev server (fast hot reload)
- **No production build needed**: React code served directly from source
- **TypeScript compiled**: Main/preload need to be compiled first
- **Synchronized**: Electron waits for dev server to be ready

## Alternative: `dev` script

The `dev` script is simpler - it just watches for changes but doesn't launch Electron:
- Watches main process TypeScript (auto-recompiles)
- Runs webpack dev server (serves React)
- **You manually run `npm start`** to launch Electron

