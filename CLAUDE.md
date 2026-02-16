# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
# Core library (root package)
npm install        # Install dependencies (includes native node-pty compilation)
npm run build      # Compile TypeScript to dist/
npm run dev        # Run directly with tsx (no build needed)

# Desktop GUI (packages/desktop-electron)
cd packages/desktop-electron
npm run dev        # Dev mode with hot-reload (Vite + Electron)
npm run build      # Build main + renderer
npm run start      # Build and launch Electron
npm run package    # Package distributable with electron-builder
```

## Architecture Overview

Brosh is a desktop terminal application with built-in AI integration via Model Context Protocol (MCP). It has three operating modes:

### Tri-Mode Architecture

1. **GUI Mode** (Electron desktop app): User launches the brosh desktop application
   - Electron app in `packages/desktop-electron/` wraps the core brosh library
   - Main process (`src/main/`) manages windows, terminal bridges, MCP server, and AI detection
   - Renderer process (`src/renderer/`) provides xterm.js-based terminal UI with pane splitting, settings, themes, Monaco editor integration, and an MCP dashboard
   - Communicates with the core library via `terminal-bridge.ts` and exposes its own MCP server via `mcp-server.ts`

2. **Interactive Mode** (stdin is TTY): User runs `brosh` in their terminal
   - Spawns a PTY shell process, pipes I/O to user's terminal
   - Exposes a Unix socket at `/tmp/brosh.sock` for AI tool access
   - `src/index.ts` -> `startInteractiveMode()` -> creates `TerminalManager` + `createToolProxyServer()`

3. **MCP Client Mode** (stdin is not TTY): Claude Code spawns `brosh` as MCP server
   - Connects to the Unix socket from interactive mode
   - Serves MCP protocol over stdio to Claude Code
   - `src/client.ts` -> `startMcpClientMode()` -> proxies tool calls to socket

### Key Components

**Terminal Layer** (`src/terminal/`):
- `session.ts`: Core integration of `node-pty` (PTY process) + `@xterm/headless` (terminal emulation). Handles shell-specific prompt customization via temp rc files.
- `manager.ts`: Singleton wrapper managing session lifecycle

**Tool Layer** (`src/tools/`):
- Each tool has: Zod schema, tool definition object, handler function
- Pattern: `export const fooTool = {...}` + `export function handleFoo(manager, args)`
- Tools: `type`, `sendKey`, `getContent`, `takeScreenshot`

**Transport Layer** (`src/transport/`):
- `socket.ts`: Unix socket server for tool proxying between modes. Also has `SocketTransport` class implementing MCP's Transport interface.

**GUI Layer** (`packages/desktop-electron/`):
- `src/main/`: Electron main process -- window management, terminal bridge, MCP server, AI CLI detection, ML classifier, analytics
- `src/renderer/`: Vite + React renderer -- xterm.js terminal, pane management, settings UI, MCP dashboard, smart status bar

### Data Flow

```
GUI Mode:
Electron Renderer (xterm.js)
    | (IPC)
Electron Main Process
    | (terminal-bridge)
brosh core (TerminalSession + ToolProxyServer)
    | (Unix socket /tmp/brosh.sock)
MCP Clients (Claude Code, etc.)

Interactive Mode:                    MCP Client Mode:
User Terminal                        Claude Code
    | (raw PTY I/O)                     | (MCP JSON-RPC over stdio)
TerminalSession                      MCP Server (client.ts)
    |                                   | (custom JSON-RPC over socket)
Tool Proxy Server <-----------------> Socket Client
```

## Code Conventions

- ES Modules with `.js` extensions in imports (NodeNext module resolution)
- Zod for runtime validation of tool arguments
- Tools return `{ content: [{ type: "text", text: string }], isError?: boolean }`
- Key sequences are in `src/utils/keys.ts` (ANSI escape codes)
