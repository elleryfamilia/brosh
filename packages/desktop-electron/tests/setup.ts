import { vi } from 'vitest';
import * as path from 'path';

// Mock the ML classifier to provide predictable classifications in tests
// This simulates the actual ML model behavior without loading the model
vi.mock('../src/main/ml-classifier.js', () => {
  // Simple heuristics to simulate ML classification
  const classifyWithML = async (input: string) => {
    const trimmed = input.trim().toLowerCase();

    // Empty input
    if (!trimmed) return null;

    // Questions (ends with ? or starts with question words)
    const questionWords = ['how', 'what', 'why', 'where', 'when', 'who', 'which', 'can', 'could', 'would', 'should'];
    const firstWord = trimmed.split(/\s+/)[0];
    if (trimmed.endsWith('?') || questionWords.includes(firstWord)) {
      return {
        classification: 'NATURAL_LANGUAGE' as const,
        confidence: 0.95,
        scores: { command: 0.05, naturalLanguage: 0.95 },
        inferenceTimeMs: 5,
      };
    }

    // First-person statements
    const firstPersonWords = ['i', "i'm", "i've", "i'd", 'my', 'me'];
    if (firstPersonWords.includes(firstWord)) {
      return {
        classification: 'NATURAL_LANGUAGE' as const,
        confidence: 0.85,
        scores: { command: 0.15, naturalLanguage: 0.85 },
        inferenceTimeMs: 5,
      };
    }

    // Default to command - the ML model primarily identifies commands
    // and the non-command heuristics above handle NL cases
    return {
      classification: 'COMMAND' as const,
      confidence: 0.9,
      scores: { command: 0.9, naturalLanguage: 0.1 },
      inferenceTimeMs: 5,
    };
  };

  return {
    classifyWithML,
    preloadModel: vi.fn().mockResolvedValue(true),
    getModelStatus: vi.fn().mockReturnValue({
      loaded: true,
      loading: false,
      error: null,
      modelName: 'brosh-ky-mock',
    }),
  };
});

// Comprehensive list of common commands for realistic testing
const MOCK_COMMANDS = [
  // Core Unix utilities
  'ls', 'cd', 'pwd', 'echo', 'cat', 'grep', 'find', 'mkdir', 'rm', 'cp', 'mv',
  'chmod', 'chown', 'chgrp', 'ln', 'touch', 'stat', 'file', 'realpath', 'basename', 'dirname',

  // Text processing
  'sed', 'awk', 'sort', 'uniq', 'head', 'tail', 'wc', 'cut', 'paste', 'tr', 'rev',
  'tee', 'xargs', 'yes', 'true', 'false',

  // File viewing
  'less', 'more', 'diff', 'cmp', 'comm', 'strings', 'hexdump', 'od',

  // Search and find
  'locate', 'updatedb', 'which', 'whereis', 'type', 'command',

  // Version control
  'git', 'svn', 'hg', 'cvs',

  // Package managers
  'npm', 'npx', 'yarn', 'pnpm', 'bun',
  'pip', 'pip3', 'pipx', 'poetry', 'conda',
  'brew', 'apt', 'apt-get', 'yum', 'dnf', 'pacman', 'zypper',
  'cargo', 'rustup',
  'go', 'gem', 'bundle',

  // Container/orchestration
  'docker', 'docker-compose', 'podman', 'kubectl', 'helm', 'minikube', 'kind',

  // Cloud CLIs
  'aws', 'gcloud', 'az', 'terraform', 'pulumi',
  'gh', 'hub', 'gitlab',

  // Languages/runtimes
  'node', 'deno', 'bun',
  'python', 'python3', 'python2',
  'ruby', 'irb', 'rake',
  'perl', 'php',
  'java', 'javac', 'jar',
  'rustc', 'swift', 'kotlin',

  // Build tools
  'make', 'cmake', 'ninja', 'meson',
  'gcc', 'g++', 'clang', 'clang++', 'ld',
  'mvn', 'gradle', 'ant',

  // Editors
  'vim', 'nvim', 'vi', 'nano', 'emacs', 'code', 'subl', 'atom',

  // Network
  'ssh', 'scp', 'sftp', 'rsync', 'curl', 'wget', 'httpie',
  'ping', 'traceroute', 'netstat', 'ss', 'ip', 'ifconfig',
  'nc', 'netcat', 'socat', 'nmap',
  'dig', 'nslookup', 'host', 'whois',

  // Archive/compression
  'tar', 'gzip', 'gunzip', 'bzip2', 'xz', 'unzip', 'zip', '7z', 'rar',

  // Process management
  'ps', 'top', 'htop', 'kill', 'pkill', 'killall', 'pgrep',
  'nice', 'renice', 'nohup', 'timeout',
  'jobs', 'fg', 'bg', 'wait', 'disown',

  // System info
  'df', 'du', 'free', 'uname', 'uptime', 'hostname', 'hostnamectl',
  'lscpu', 'lsmem', 'lsblk', 'lsusb', 'lspci',
  'w', 'who', 'whoami', 'id', 'groups', 'users', 'last', 'lastlog',

  // Date/time
  'date', 'cal', 'time', 'timedatectl',

  // Documentation
  'man', 'info', 'help', 'apropos', 'whatis',

  // Shell utilities
  'env', 'export', 'source', 'alias', 'unalias', 'set', 'unset',
  'history', 'fc', 'exit', 'logout', 'clear', 'reset',
  'test', 'expr', 'bc', 'dc', 'printf', 'read',

  // Terminal multiplexers
  'tmux', 'screen', 'mosh', 'byobu',

  // Modern CLI tools
  'jq', 'yq', 'fx',
  'bat', 'exa', 'eza', 'lsd', 'tree',
  'rg', 'ag', 'ack',
  'fd', 'fzf', 'sk',
  'delta', 'difft',
  'tldr', 'cheat',
  'zoxide', 'autojump', 'fasd',
  'direnv', 'asdf', 'mise',

  // Database clients
  'mysql', 'psql', 'sqlite3', 'mongo', 'redis-cli',

  // Testing/linting
  'jest', 'mocha', 'pytest', 'rspec',
  'eslint', 'prettier', 'black', 'flake8', 'mypy',
  'shellcheck', 'shfmt',
];

// Mock child_process to return a predictable set of commands
vi.mock('child_process', () => ({
  execSync: vi.fn((cmd: string) => {
    // Return common commands for command cache initialization
    if (cmd.includes('compgen') || cmd.includes('commands')) {
      return MOCK_COMMANDS.join('\n');
    }
    // Return some common aliases
    if (cmd.includes('alias')) {
      return [
        'alias ll="ls -la"',
        'alias la="ls -a"',
        'alias l="ls -CF"',
        'alias g="git"',
        'alias gst="git status"',
        'alias gco="git checkout"',
        'alias gp="git push"',
        'alias gl="git pull"',
        'alias dc="docker-compose"',
        'alias k="kubectl"',
      ].join('\n');
    }
    // Return shell functions for function cache initialization
    if (cmd.includes('functions') || cmd.includes('declare -F')) {
      return MOCK_FUNCTIONS.join('\n');
    }
    // Handle `command -v <cmd>` queries
    if (cmd.startsWith('command -v ')) {
      const cmdToCheck = cmd.replace('command -v ', '').trim();
      // Empty or invalid command should throw
      if (!cmdToCheck || cmdToCheck.length === 0) {
        throw new Error('command not found');
      }
      // Check if command is in our mock list or dynamic list
      const allKnown = [...MOCK_COMMANDS, 'newcmd', 'latestool', 'll', 'la', 'l', 'g', 'gst', 'gco', 'gp', 'gl', 'dc', 'k'];
      if (allKnown.includes(cmdToCheck)) {
        return `/usr/bin/${cmdToCheck}`;
      }
      // Unknown command throws
      throw new Error('command not found');
    }
    return '';
  }),
  exec: vi.fn(),
}));

// Mock fs to simulate PATH lookups for commands not in the initial cache
// This allows testing the "checkPathDirectly" fallback
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: vi.fn((filePath: string) => {
      // Don't match empty or invalid paths
      if (!filePath || filePath.length < 2) return false;

      // Simulate finding commands in PATH
      // Extract command name from path like "/usr/bin/eza"
      const cmd = path.basename(filePath);

      // Don't match empty command names
      if (!cmd || cmd.length === 0) return false;

      // Commands in MOCK_COMMANDS are "found" in PATH
      if (MOCK_COMMANDS.includes(cmd)) {
        return true;
      }
      // Also check for commands that might be discovered dynamically
      const dynamicCommands = ['newcmd', 'latestool'];
      if (dynamicCommands.includes(cmd)) {
        return true;
      }
      return false;
    }),
    statSync: vi.fn((filePath: string) => {
      if (!filePath || filePath.length < 2) {
        throw new Error('ENOENT');
      }
      const cmd = path.basename(filePath);
      if (!cmd || cmd.length === 0) {
        throw new Error('ENOENT');
      }
      if (MOCK_COMMANDS.includes(cmd) || ['newcmd', 'latestool'].includes(cmd)) {
        return { isFile: () => true };
      }
      throw new Error('ENOENT');
    }),
  };
});

// Mock shell functions (like those loaded from .zshrc plugins)
const MOCK_FUNCTIONS = [
  // Powerlevel10k
  'p10k',
  // Node version manager
  'nvm',
  // Python version manager
  'pyenv',
  // Ruby version manager
  'rbenv',
  // Direnv
  'direnv',
  // Zoxide
  'z',
  '__zoxide_z',
  // FZF
  'fzf-history-widget',
  // Some internal functions (should be filtered out)
  '_p10k_worker_start',
  '_nvm_auto',
  '-my-hidden-func',
];

// Export for tests that need to verify mock data
export { MOCK_COMMANDS, MOCK_FUNCTIONS };
