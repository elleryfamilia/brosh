import * as fs from "fs";
import { Server as NetServer, Socket, connect as netConnect } from "net";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { TerminalManager } from "../terminal/index.js";
import { getStats } from "../utils/stats.js";

// Status file for shell prompt to read MCP connection status
const MCP_STATUS_FILE = "/tmp/brosh-mcp-status";

/**
 * Write MCP status to file for shell prompt to read
 */
function writeMcpStatus(enabled: boolean): void {
  try {
    fs.writeFileSync(MCP_STATUS_FILE, enabled ? "enabled" : "disabled");
  } catch {
    // Ignore errors - status file is optional
  }
}

/**
 * Get the MCP status file path (for shell prompt integration)
 */
export function getMcpStatusFile(): string {
  return MCP_STATUS_FILE;
}

// Tool handlers
import { handleType } from "../tools/type.js";
import { handleSendKey } from "../tools/sendKey.js";
import { handleGetContent } from "../tools/getContent.js";
import { handleScreenshot } from "../tools/screenshot.js";
import { handleStartRecording } from "../tools/startRecording.js";
import { handleStopRecording } from "../tools/stopRecording.js";

interface SocketRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface SocketResponse {
  id: number;
  result?: unknown;
  error?: { message: string };
}

/**
 * Check if a socket path is already in use by another server.
 * Attempts to connect - if successful, another instance is running.
 * Returns a promise that resolves to true if in use, false otherwise.
 */
export function isSocketInUse(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Check if socket file exists first
    if (!fs.existsSync(socketPath)) {
      resolve(false);
      return;
    }

    const client = netConnect(socketPath);

    // Set a short timeout for the connection attempt
    const timeout = setTimeout(() => {
      client.destroy();
      resolve(false);
    }, 1000);

    client.on("connect", () => {
      clearTimeout(timeout);
      client.destroy();
      resolve(true);
    });

    client.on("error", () => {
      clearTimeout(timeout);
      client.destroy();
      resolve(false);
    });
  });
}

/**
 * Check if socket is in use and log a warning if taking over from another instance.
 * Call this before createToolProxyServer to notify users of the takeover.
 * Returns the owner type if detected ("cli" or "gui"), or null if not in use.
 */
export async function checkSocketAndWarn(socketPath: string): Promise<"cli" | "gui" | null> {
  const inUse = await isSocketInUse(socketPath);
  if (inUse) {
    console.error(
      `[brosh] Warning: Taking over socket from another brosh instance at ${socketPath}`
    );
    console.error(
      "[brosh] The other instance's MCP connections will be disconnected."
    );
    return "cli"; // Can't distinguish, assume generic
  }
  return null;
}

/**
 * Transport that communicates over a Unix socket connection
 * (Used for full MCP protocol when needed)
 */
export class SocketTransport implements Transport {
  private socket: Socket;
  private buffer = "";

  onmessage?: (message: JSONRPCMessage) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;

  constructor(socket: Socket) {
    this.socket = socket;

    this.socket.on("data", (data) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.socket.on("error", (error) => {
      this.onerror?.(error);
    });

    this.socket.on("close", () => {
      this.onclose?.();
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line) as JSONRPCMessage;
          this.onmessage?.(message);
        } catch (error) {
          this.onerror?.(new Error(`Failed to parse message: ${line}`));
        }
      }
    }
  }

  async start(): Promise<void> {
    // Socket is already connected
  }

  async close(): Promise<void> {
    this.socket.end();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(message) + "\n";
      this.socket.write(data, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}

/**
 * Create a Unix socket server that accepts MCP connections
 */
export function createSocketServer(
  socketPath: string,
  onConnection: (transport: SocketTransport) => void
): NetServer {
  // Remove existing socket file if it exists
  try {
    fs.unlinkSync(socketPath);
  } catch {
    // Ignore if doesn't exist
  }

  const server = new NetServer((socket) => {
    const transport = new SocketTransport(socket);
    onConnection(transport);
  });

  server.listen(socketPath);

  return server;
}

/**
 * Create a simple request/response socket server for tool proxying
 * This is the protocol used between interactive mode and MCP client mode
 */
export function createToolProxyServer(
  socketPath: string,
  manager: TerminalManager
): NetServer {
  // Remove existing socket file if it exists
  try {
    fs.unlinkSync(socketPath);
  } catch {
    // Ignore if doesn't exist
  }

  // Track active client - only one MCP connection allowed at a time
  let activeClient: Socket | null = null;

  const server = new NetServer((socket) => {
    // Disconnect existing client — only one MCP connection at a time
    if (activeClient) {
      console.error("[brosh] New MCP client connected, disconnecting previous client");
      activeClient.destroy();
      activeClient = null;
    }
    activeClient = socket;

    let buffer = "";

    socket.on("data", async (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          try {
            const request = JSON.parse(line) as SocketRequest;
            const response = await handleToolRequest(manager, request);
            socket.write(JSON.stringify(response) + "\n");
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            socket.write(
              JSON.stringify({
                id: 0,
                error: { message: `Parse error: ${errorMessage}` },
              }) + "\n"
            );
          }
        }
      }
    });

    socket.on("close", () => {
      if (activeClient === socket) {
        activeClient = null;
      }
    });

    socket.on("error", () => {
      if (activeClient === socket) {
        activeClient = null;
      }
    });
  });

  server.listen(socketPath);

  // Watch for socket file being replaced (another instance taking over)
  // Track the inode of our socket - if it changes, someone replaced it
  let socketStolen = false;
  let originalInode: bigint | null = null;

  // Get the inode of our socket file after server starts listening
  server.once("listening", () => {
    try {
      const stats = fs.statSync(socketPath, { bigint: true });
      originalInode = stats.ino;
      // Write "enabled" status for shell prompt
      writeMcpStatus(true);
    } catch {
      // Couldn't get inode, watcher won't work
    }
  });

  const watchInterval = setInterval(() => {
    if (socketStolen || originalInode === null) return;

    try {
      // Check if socket file still exists and has the same inode
      const stats = fs.statSync(socketPath, { bigint: true });
      if (!stats.isSocket() || stats.ino !== originalInode) {
        // File was replaced by another instance
        socketStolen = true;
        writeMcpStatus(false);
        console.error("\n[brosh] Socket was taken over by another brosh instance (GUI or CLI)");
        console.error("[brosh] MCP clients can no longer connect to this session\n");

        // Disconnect any active client since they're now orphaned
        if (activeClient) {
          activeClient.destroy();
          activeClient = null;
        }
      }
    } catch {
      // Socket file was deleted - another instance took over
      socketStolen = true;
      writeMcpStatus(false);
      console.error("\n[brosh] Socket was taken over by another brosh instance (GUI or CLI)");
      console.error("[brosh] MCP clients can no longer connect to this session\n");

      // Disconnect any active client since they're now orphaned
      if (activeClient) {
        activeClient.destroy();
        activeClient = null;
      }
    }
  }, 2000); // Check every 2 seconds

  // Clean up watcher when server closes
  server.on("close", () => {
    clearInterval(watchInterval);
    writeMcpStatus(false);
  });

  return server;
}

/**
 * Handle a tool request from the MCP client
 */
async function handleToolRequest(
  manager: TerminalManager,
  request: SocketRequest
): Promise<SocketResponse> {
  const { id, method, params } = request;
  const stats = getStats();

  try {
    let result: unknown;

    switch (method) {
      case "type":
        stats.recordToolCall("type");
        result = handleType(manager, params);
        break;

      case "sendKey":
        stats.recordToolCall("sendKey");
        result = handleSendKey(manager, params);
        break;

      case "getContent":
        stats.recordToolCall("getContent");
        result = handleGetContent(manager, params);
        break;

      case "takeScreenshot":
        stats.recordToolCall("takeScreenshot");
        result = handleScreenshot(manager, params);
        break;

      case "startRecording":
        stats.recordToolCall("startRecording");
        result = handleStartRecording(manager, params);
        break;

      case "stopRecording":
        stats.recordToolCall("stopRecording");
        result = await handleStopRecording(manager, params);
        break;

      default:
        return {
          id,
          error: { message: `Unknown method: ${method}` },
        };
    }

    return { id, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id,
      error: { message },
    };
  }
}
