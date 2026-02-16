import * as path from "path";
import * as os from "os";
import { getEnv } from "./env.js";

/**
 * Get the default recording directory.
 * Uses XDG_STATE_HOME or falls back to ~/.local/state/brosh/recordings.
 * Can be overridden with BROSH_RECORD_DIR (or legacy TERMINAL_MCP_RECORD_DIR) environment variable.
 */
export function getDefaultRecordDir(): string {
  // Check env var override first (supports legacy TERMINAL_MCP_RECORD_DIR)
  const envDir = getEnv('BROSH_RECORD_DIR', 'TERMINAL_MCP_RECORD_DIR');
  if (envDir) {
    return envDir;
  }

  // Use XDG_STATE_HOME or fallback
  const stateHome = process.env.XDG_STATE_HOME
    || path.join(os.homedir(), '.local', 'state');

  return path.join(stateHome, 'brosh', 'recordings');
}

/**
 * Get the default IPC path for cross-platform communication.
 * Uses named pipes on Windows, Unix sockets elsewhere.
 */
export function getDefaultSocketPath(): string {
  if (process.platform === "win32") {
    return "\\\\.\\pipe\\brosh";
  }
  // Use /tmp directly instead of os.tmpdir() which returns user-specific paths on macOS
  // (e.g., /var/folders/vj/.../T/). This ensures CLI and GUI use the same socket path.
  return "/tmp/brosh.sock";
}

/**
 * Get the default shell for the current platform.
 */
export function getDefaultShell(): string {
  if (process.platform === "win32") {
    return process.env.COMSPEC || "cmd.exe";
  }
  return process.env.SHELL || "/bin/bash";
}
