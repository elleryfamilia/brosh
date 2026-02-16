# Installation

This guide covers how to install brosh as a desktop app or CLI tool.

## Desktop App

### GitHub Releases (recommended)

Download the latest release for your platform from the [releases page](https://github.com/elleryfamilia/brosh/releases):

- **macOS**: `.dmg` file
- **Linux**: `.AppImage` file

### Build from Source

1. Clone the repository:

```bash
git clone https://github.com/elleryfamilia/brosh.git
cd brosh/packages/desktop-electron
```

2. Install dependencies:

```bash
npm install
```

3. Run or package:

```bash
npm run start        # Build and launch immediately
npm run package      # Build distributable for your platform
```

## CLI / MCP Server

The CLI can be installed independently of the desktop app.

### Prerequisites

#### Node.js

brosh requires Node.js 18.0.0 or later. Check your version:

```bash
node --version
```

If you need to install or update Node.js, visit [nodejs.org](https://nodejs.org/) or use a version manager like [nvm](https://github.com/nvm-sh/nvm).

#### Build Tools

brosh uses `node-pty`, a native module that requires compilation. You'll need platform-specific build tools:

**macOS:**

```bash
xcode-select --install
```

**Linux (Debian/Ubuntu):**

```bash
sudo apt-get install build-essential python3
```

**Linux (RHEL/CentOS/Fedora):**

```bash
sudo dnf groupinstall "Development Tools"
sudo dnf install python3
```

**Windows (CLI only):**

Install windows-build-tools (requires Administrator PowerShell):

```powershell
npm install --global windows-build-tools
```

Or install Visual Studio Build Tools manually from [visualstudio.microsoft.com](https://visualstudio.microsoft.com/visual-cpp-build-tools/).

### Installation Methods

#### npm (recommended)

```bash
npm install -g brosh
```

#### Install Script

```bash
curl -fsSL https://raw.githubusercontent.com/elleryfamilia/brosh/main/install.sh | bash
```

This clones the repo, builds it, and creates a `brosh` symlink in your PATH.

#### From Source

```bash
git clone https://github.com/elleryfamilia/brosh.git
cd brosh
npm install
npm run build
```

### MCP Client Integration

After installing the CLI, add brosh to your MCP client configuration:

```json
{
  "mcpServers": {
    "terminal": {
      "command": "brosh"
    }
  }
}
```

With custom options:

```json
{
  "mcpServers": {
    "terminal": {
      "command": "brosh",
      "args": ["--cols", "100", "--rows", "30", "--shell", "/bin/zsh"]
    }
  }
}
```

### Verify Integration

After configuring, restart your MCP client and verify the tools are available:

1. The terminal tools should appear in the available tools list
2. Try a simple command: "Use the terminal to echo hello world"

## Troubleshooting

### Native Module Compilation Errors

If you see errors about `node-pty` compilation:

1. Ensure build tools are installed (see Prerequisites)
2. Try clearing npm cache: `npm cache clean --force`
3. Remove node_modules and reinstall: `rm -rf node_modules && npm install`
4. On Windows, ensure you're using a compatible Node.js architecture (x64)

### Permission Errors

On Unix systems, ensure the entry point is executable:

```bash
chmod +x dist/index.js
```

### Shell Not Found

If your default shell isn't found, specify it explicitly:

```bash
node dist/index.js --shell /bin/bash
```

### MCP Connection Issues

1. Verify the path in your configuration is absolute
2. Check that Node.js is in your PATH
3. Look at your MCP client's logs for error messages
4. Test the server manually:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | node dist/index.js
```

You should see a JSON response with `serverInfo`.

## Development Setup

For development with hot reloading:

```bash
# CLI / core library
npm run dev

# Desktop app
cd packages/desktop-electron
npm run dev
```

## Updating

### Desktop App

Download the latest release from the [releases page](https://github.com/elleryfamilia/brosh/releases).

### CLI

Re-run the install script:

```bash
curl -fsSL https://raw.githubusercontent.com/elleryfamilia/brosh/main/install.sh | bash
```

Or manually:

```bash
cd ~/.brosh
git pull
npm install
npm run build
```
