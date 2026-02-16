# brosh

The terminal built for vibe coding with Claude.

## What is brosh?

brosh is a desktop terminal where you can type natural language alongside shell commands. An ML classifier detects when you're asking a question and routes it to Claude Code automatically -- no mode switching required. It also gives Claude Code full MCP access to your terminal so it can run commands, read output, and drive interactive programs on your behalf.

brosh works in three modes:

1. **Desktop App** (primary) -- An Electron-based terminal with split panes, themes, git sidebar, Monaco editor, and a built-in MCP server that lets AI assistants interact with your terminal
2. **Interactive CLI** -- Run `brosh` in any terminal to get a PTY session with an MCP server on a Unix socket
3. **MCP Client** -- Claude Code spawns `brosh` as an MCP server to proxy tool calls to a running interactive session

## Key Features

- **Claude Code Integration**: Natural language detection, model switching (Sonnet/Opus/Haiku), "Continue in Claude" handoff, smart status bar
- **Built-in MCP Server**: Claude Code connects over MCP and can see, type, and interact with your terminal session
- **Desktop Terminal**: Multi-tab, split panes, 9 themes, 25+ fonts, draggable dividers, find bar, window opacity
- **Git Integration**: Visual commit graph, file change tracking, Monaco diff editor, branch/remote tracking
- **Sandbox Mode**: Optional filesystem and network restrictions so Claude can only touch what you allow
- **Session Recording**: Record to asciicast v2 format for playback with asciinema
- **Cross-Platform**: macOS, Linux

## Quick Start

### Desktop App

1. Download from the [releases page](https://github.com/elleryfamilia/brosh/releases) or build from source
2. Launch the app -- a terminal session opens automatically
3. Use <kbd>Cmd</kbd>+<kbd>D</kbd> to split panes, <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> for the git sidebar
4. Connect Claude Code via the built-in MCP server

### CLI

```bash
npm install -g brosh
brosh
```

Configure in Claude Code's MCP settings:

```json
{
  "mcpServers": {
    "terminal": {
      "command": "brosh"
    }
  }
}
```

## How It Works

```
Desktop App (GUI Mode):
Electron Renderer (xterm.js)
    | (IPC)
Electron Main Process
    | (terminal-bridge)
brosh core (TerminalSession + ToolProxyServer)
    | (Unix socket /tmp/brosh.sock)
MCP Clients (Claude Code, etc.)

CLI Mode:
User Terminal                        Claude Code
    | (raw PTY I/O)                     | (MCP JSON-RPC over stdio)
TerminalSession                      MCP Server (client.ts)
    |                                   | (custom JSON-RPC over socket)
Tool Proxy Server <-----------------> Socket Client
```

1. The desktop app (or CLI) spawns a PTY shell and exposes an MCP server on a Unix socket
2. AI assistants connect and send commands via MCP tools (`type`, `sendKey`, etc.)
3. brosh writes to the pseudo-terminal connected to a real shell
4. Output is captured by the xterm.js terminal emulator
5. The AI reads terminal state via `getContent` or `takeScreenshot`

## Documentation

- [Installation](./installation.md) -- Setup for desktop app and CLI
- [Tools Reference](./tools.md) -- Complete MCP tool API documentation
- [Recording](./recording.md) -- Session recording to asciicast format
- [Configuration](./configuration.md) -- CLI options and customization
- [Sandbox Mode](./sandbox.md) -- Security restrictions for filesystem and network
- [Examples](./examples.md) -- CLI/MCP usage examples and common patterns
- [Architecture](./architecture.md) -- Technical architecture and development guide

## Requirements

- **Desktop App**: macOS 10.15+, Linux
- **CLI**: Node.js 18+, build tools for native module compilation (node-pty)

## License

MIT
