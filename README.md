<p align="center">
  <strong>The AI-native terminal. Built for Claude coders.</strong>
</p>

<p align="center">
  <a href="https://github.com/elleryfamilia/brosh/releases"><img src="https://img.shields.io/github/v/release/elleryfamilia/brosh" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/elleryfamilia/brosh" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-blue" alt="Platforms">
</p>

![intro screen](docs/images/intro_screen.png)

## Install

**macOS (Homebrew):**

```bash
brew install --cask elleryfamilia/brosh/brosh
```

**Ubuntu/Debian:**

```bash
curl -fsSL https://elleryfamilia.github.io/brosh/install.sh | sudo bash
```

**Arch Linux (AUR):**

```bash
yay -S brosh-bin
```

**Direct download:** `.dmg` (macOS) / `.deb` (Linux) from the [releases page](https://github.com/elleryfamilia/brosh/releases).

**Build from source:**

```bash
git clone https://github.com/elleryfamilia/brosh.git
cd brosh/packages/desktop-electron && npm install && npm run start
```

**CLI only:** `npm install -g brosh` or `brew install elleryfamilia/brosh/brosh-cli` -- [more install options](./docs/installation.md)

---

## As much or as little as you'd like

brosh gives you a terminal that grows with your workflow. Start minimal, add AI when you need it.

### Just a terminal

At its simplest, brosh is a fast, themeable terminal with split panes, tabs, and a smart status bar.

![terminal](docs/images/terminal_screen.png)

### Add Claude Code

Open a side-by-side pane and Claude Code is right there -- connected to your terminal over MCP, ready to help.

![claude code](docs/images/claudecode_screen.png)

### Plugins when you need them

Git, Context, Plans, Files -- built-in plugins live in the status bar and open as sidebars when you need them. Here the Context plugin gives Claude visibility into your project's CLAUDE.md files, documentation, and codebase structure.

![context plugin](docs/images/context_screen.png)

## Features

- **Claude Code integration** -- Built-in MCP server, model switching, natural language detection, "Continue in Claude" handoff
- **Built-in plugins** -- Git, Context, Plans, and Files sidebars available when you need them
- **Split panes & tabs** -- Horizontal/vertical splits with draggable dividers, multi-tab interface
- **Sandbox mode** -- Restrict filesystem and network access per session
- **Themes & customization** -- 9 themes, 25+ fonts, cursor styles, window opacity, scrollback
- **MCP tools** -- Claude Code can type, read, and screenshot your terminal directly
- **Session recording** -- Record to asciicast format, play back with asciinema
- **Cross-platform** -- macOS, Linux

## MCP Integration

The desktop app runs a built-in MCP server on a Unix socket, giving Claude Code direct access to your terminal session.

Add to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "terminal": {
      "command": "brosh"
    }
  }
}
```

| Tool | Description |
|------|-------------|
| `type` | Send text input to the terminal |
| `sendKey` | Send special keys and key combinations |
| `getContent` | Retrieve terminal buffer content |
| `takeScreenshot` | Capture terminal state with metadata |
| `startRecording` | Start recording terminal output |
| `stopRecording` | Stop recording and save file |

See [docs/tools.md](./docs/tools.md) for the full API reference.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| <kbd>Cmd</kbd>+<kbd>T</kbd> | New tab |
| <kbd>Cmd</kbd>+<kbd>N</kbd> | New window |
| <kbd>Cmd</kbd>+<kbd>W</kbd> | Close tab |
| <kbd>Cmd</kbd>+<kbd>D</kbd> | Split pane vertically |
| <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> | Split pane horizontally |
| <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> | Toggle git sidebar |
| <kbd>Cmd</kbd>+<kbd>F</kbd> | Find in terminal |
| <kbd>Cmd</kbd>+<kbd>,</kbd> | Settings |

## CLI Mode

brosh also works as a standalone CLI terminal and MCP server without the desktop app:

```bash
brosh              # Interactive mode -- shell + MCP server on Unix socket
brosh --sandbox    # With filesystem/network restrictions
brosh --record     # With session recording
```

See the [docs/](./docs/) folder for CLI flags, recording, and sandbox configuration.

## Development

```bash
# Core library
npm install && npm run build

# Desktop app
cd packages/desktop-electron
npm run dev          # Dev mode with hot-reload
npm run package      # Build distributable
```

### Linux: Sandbox binaries

The desktop app bundles statically-compiled `socat` and `bwrap` (bubblewrap) so sandbox mode works out of the box on any Linux distro. The binaries are built automatically during `npm run package` (via `prepackage`). You just need the build tools installed:

```bash
# One-time setup (Linux only)
sudo apt-get install -y meson ninja-build pkg-config libcap-dev
```

The script fetches the latest source releases from upstream, compiles static binaries, and places them in `resources/bin/`. On macOS the step is a no-op. You can also run it manually with `npm run prepare-sandbox-bins`.

## Documentation

- [Overview](./docs/index.md) -- [Installation](./docs/installation.md) -- [Architecture](./docs/architecture.md)
- [Tools Reference](./docs/tools.md) -- [Configuration](./docs/configuration.md) -- [Examples](./docs/examples.md)
- [Recording](./docs/recording.md) -- [Sandbox Mode](./docs/sandbox.md)

## Requirements

- **Desktop App**: macOS 10.15+, Linux
- **CLI**: Node.js 18+

## License

MIT

The Linux desktop build bundles [socat](http://www.dest-unreach.org/socat/) (GPL-2.0) and [bubblewrap](https://github.com/containers/bubblewrap) (LGPL-2.1) as standalone executables for sandbox support. See [`packages/desktop-electron/THIRD-PARTY-NOTICES`](packages/desktop-electron/THIRD-PARTY-NOTICES) for full license texts.
