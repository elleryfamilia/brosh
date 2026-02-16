# brosh

A terminal emulator and MCP server that gives Claude Code direct access to your terminal.

brosh runs a shell inside a PTY with a headless xterm emulator, exposing tools over the [Model Context Protocol](https://modelcontextprotocol.io/) so AI agents can type commands, read output, send key combinations, and take screenshots.

## Install

```bash
npm install -g brosh
```

## CLI Usage

```bash
brosh                # Interactive mode -- shell + MCP server on Unix socket
brosh --sandbox      # With filesystem/network restrictions
brosh --record       # With session recording (asciicast format)
```

## MCP Integration

Add to your Claude Code MCP config (`~/.claude/settings.json` or `.mcp.json`):

```json
{
  "mcpServers": {
    "terminal": {
      "command": "brosh"
    }
  }
}
```

When Claude Code launches brosh as an MCP server, it connects to the running interactive session over a Unix socket and proxies tool calls.

### Tools

| Tool | Description |
|------|-------------|
| `type` | Send text input to the terminal |
| `sendKey` | Send special keys and key combinations (Enter, Ctrl+C, etc.) |
| `getContent` | Retrieve terminal buffer content |
| `takeScreenshot` | Capture terminal state with ANSI formatting |
| `startRecording` | Start recording terminal output |
| `stopRecording` | Stop recording and save file |

## Desktop App

brosh also ships as a full desktop terminal (Electron) with split panes, tabs, a Git sidebar, themes, and more. See the [GitHub repo](https://github.com/elleryfamilia/brosh) for install instructions and documentation.

## Requirements

- Node.js 18+

## License

MIT
