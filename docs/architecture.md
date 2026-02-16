# Architecture

This document describes the technical architecture of brosh and provides guidance for development and contribution.

## Tri-Mode Architecture

brosh operates in three modes:

### 1. GUI Mode (Electron Desktop App)

The primary interface. User launches the brosh desktop application.

- Electron app in `packages/desktop-electron/` wraps the core brosh library
- Main process (`src/main/`) manages windows, terminal bridges, MCP server, and AI detection
- Renderer process (`src/renderer/`) provides xterm.js-based terminal UI with pane splitting, settings, themes, Monaco editor integration, and an MCP dashboard
- Communicates with the core library via `terminal-bridge.ts` and exposes its own MCP server via `mcp-server.ts`

### 2. Interactive CLI Mode (stdin is TTY)

User runs `brosh` in their terminal.

- Spawns a PTY shell process, pipes I/O to user's terminal
- Exposes a Unix socket at `/tmp/brosh.sock` for AI tool access
- `src/index.ts` -> `startInteractiveMode()` -> creates `TerminalManager` + `createToolProxyServer()`

### 3. MCP Client Mode (stdin is not TTY)

Claude Code spawns `brosh` as MCP server.

- Connects to the Unix socket from interactive mode
- Serves MCP protocol over stdio to Claude Code
- `src/client.ts` -> `startMcpClientMode()` -> proxies tool calls to socket

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     GUI Mode (Electron)                          │
│  ┌─────────────────────────────┐  ┌──────────────────────────┐  │
│  │    Renderer Process         │  │    Main Process           │  │
│  │  ┌───────────────────────┐  │  │  ┌────────────────────┐  │  │
│  │  │  xterm.js Terminal    │  │  │  │  Terminal Bridge    │  │  │
│  │  │  Pane Manager         │──│──│──│  MCP Server         │  │  │
│  │  │  Settings / Themes    │  │  │  │  AI Detection       │  │  │
│  │  │  Git Sidebar          │  │  │  │  Window Manager     │  │  │
│  │  │  MCP Dashboard        │  │  │  └─────────┬──────────┘  │  │
│  │  │  Monaco Editor        │  │  │            │              │  │
│  │  └───────────────────────┘  │  └────────────┼──────────────┘  │
│  └─────────────────────────────┘               │                 │
└────────────────────────────────────────────────┼─────────────────┘
                                                 │ (brosh core)
                                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                     brosh Core Library                           │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │  MCP SDK     │  │    Tools     │  │  Terminal Manager  │    │
│  │  (Protocol)  │──│  (Handlers)  │──│    (Lifecycle)     │    │
│  └──────────────┘  └──────────────┘  └─────────┬──────────┘    │
│                                                 │                │
│                                      ┌──────────▼──────────┐    │
│                                      │  Terminal Session   │    │
│                                      │  ┌────────────────┐ │    │
│                                      │  │  xterm.js      │ │    │
│                                      │  │  (Headless)    │ │    │
│                                      │  └───────┬────────┘ │    │
│                                      │  ┌───────▼────────┐ │    │
│                                      │  │   node-pty     │ │    │
│                                      │  │    (PTY)       │ │    │
│                                      │  └───────┬────────┘ │    │
│                                      └──────────┼──────────┘    │
└─────────────────────────────────────────────────┼───────────────┘
                                                  │
                                      ┌───────────▼──────────┐
                                      │   Shell Process      │
                                      │  (bash, zsh, etc.)   │
                                      └──────────────────────┘
```

## Data Flow

### GUI Mode

```
Electron Renderer (xterm.js)
    | (IPC)
Electron Main Process
    | (terminal-bridge)
brosh core (TerminalSession + ToolProxyServer)
    | (Unix socket /tmp/brosh.sock)
MCP Clients (Claude Code, etc.)
```

### CLI Mode

```
Interactive Mode:                    MCP Client Mode:
User Terminal                        Claude Code
    | (raw PTY I/O)                     | (MCP JSON-RPC over stdio)
TerminalSession                      MCP Server (client.ts)
    |                                   | (custom JSON-RPC over socket)
Tool Proxy Server <-----------------> Socket Client
```

### Input Flow (AI -> Terminal)

1. AI calls MCP tool (e.g., `type` with "ls")
2. Server receives JSON-RPC request
3. Tool handler calls `manager.write("ls")`
4. Manager delegates to `session.write("ls")`
5. Session writes to PTY process
6. PTY sends to shell, shell executes

### Output Flow (Terminal -> AI)

1. Shell produces output
2. PTY receives output, fires `onData`
3. Session writes to xterm.js terminal emulator
4. xterm.js processes ANSI codes
5. AI calls `getContent` or `takeScreenshot`
6. Handler reads from terminal buffer and returns via MCP response

## Core Components

### GUI Layer (`packages/desktop-electron/`)

- `src/main/`: Electron main process -- window management, terminal bridge, MCP server, AI CLI detection, ML classifier, analytics
- `src/renderer/`: Vite + React renderer -- xterm.js terminal, pane management, settings UI, MCP dashboard, smart status bar, git sidebar, Monaco editor

### Terminal Layer (`src/terminal/`)

- `session.ts`: Core integration of `node-pty` (PTY process) + `@xterm/headless` (terminal emulation). Handles shell-specific prompt customization via temp rc files.
- `manager.ts`: Singleton wrapper managing session lifecycle

### Tool Layer (`src/tools/`)

- Each tool has: Zod schema, tool definition object, handler function
- Pattern: `export const fooTool = {...}` + `export function handleFoo(manager, args)`
- Tools: `type`, `sendKey`, `getContent`, `takeScreenshot`, `startRecording`, `stopRecording`

### Transport Layer (`src/transport/`)

- `socket.ts`: Unix socket server for tool proxying between modes. Also has `SocketTransport` class implementing MCP's Transport interface.

## Technology Choices

| Technology | Role |
|------------|------|
| Electron | Desktop app shell (main + renderer processes) |
| React + Vite | Renderer UI framework and build tool |
| xterm.js | Terminal emulation (both GUI and headless) |
| node-pty | Cross-platform PTY management |
| Monaco Editor | Code/diff editor in GUI |
| @modelcontextprotocol/sdk | MCP protocol implementation |
| Zod | Runtime schema validation |

## File Structure

```
brosh/
├── src/                          # Core library
│   ├── index.ts                  # CLI entry point
│   ├── client.ts                 # MCP client mode
│   ├── terminal/
│   │   ├── session.ts            # PTY + xterm integration
│   │   └── manager.ts            # Session lifecycle
│   ├── tools/
│   │   ├── index.ts              # Tool registry
│   │   ├── type.ts               # type tool
│   │   ├── sendKey.ts            # sendKey tool
│   │   ├── getContent.ts         # getContent tool
│   │   └── screenshot.ts         # takeScreenshot tool
│   ├── transport/
│   │   └── socket.ts             # Unix socket server/client
│   └── utils/
│       └── keys.ts               # Key code mappings
├── packages/
│   └── desktop-electron/         # Desktop app
│       ├── src/main/             # Electron main process
│       ├── src/renderer/         # React renderer (Vite)
│       └── package.json
├── docs/                         # Documentation
├── package.json
└── tsconfig.json
```

## Development

### Building

```bash
# Core library
npm run build    # Compile TypeScript
npm run dev      # Run with tsx (development)

# Desktop app
cd packages/desktop-electron
npm run dev      # Dev mode with hot-reload
npm run build    # Production build (main + renderer)
npm run package  # Package distributable
```

### TypeScript Configuration

- Target: ES2022
- Module: NodeNext (ESM)
- Strict mode enabled
- Source maps for debugging

### Adding a New MCP Tool

1. Create tool file in `src/tools/`:

```typescript
// src/tools/newTool.ts
import { z } from "zod";
import { TerminalManager } from "../terminal/index.js";

export const newToolSchema = z.object({
  param: z.string().describe("Parameter description"),
});

export const newTool = {
  name: "newTool",
  description: "What this tool does",
  inputSchema: {
    type: "object" as const,
    properties: {
      param: { type: "string", description: "..." },
    },
    required: ["param"],
  },
};

export function handleNewTool(manager: TerminalManager, args: unknown) {
  const parsed = newToolSchema.parse(args);
  return {
    content: [{ type: "text" as const, text: "Result" }],
  };
}
```

2. Register in `src/tools/index.ts`:

```typescript
import { newTool, handleNewTool } from "./newTool.js";

const tools = [...existingTools, newTool];

// In switch statement:
case "newTool":
  return handleNewTool(manager, args);
```
